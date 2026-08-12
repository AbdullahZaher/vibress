import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { Socket, isIP, isIPv4, isIPv6 } from 'node:net';
import { withSpan } from '@vibress/observability';

export class SafeFetchError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Normalizes IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 -> 127.0.0.1).
 */
export function normalizeIP(ip: string): string {
  let cleaned = ip.trim();
  // Strip surrounding brackets for IPv6 if present
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    cleaned = cleaned.slice(1, -1);
  }
  // IPv4-mapped IPv6: ::ffff:192.0.2.128
  const match = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(cleaned);
  if (match && match[1]) {
    return match[1];
  }
  return cleaned;
}

/**
 * Checks whether an IPv4 or IPv6 address belongs to a private, loopback,
 * link-local, multicast, or reserved range per RFCs.
 */
export function isPrivateIP(rawIp: string): boolean {
  const ip = normalizeIP(rawIp);

  if (isIPv4(ip)) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true; // Malformed IPv4 treated as unsafe
    }

    const [a, b, c] = parts as [number, number, number, number];

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;
    // 10.0.0.0/8 (Private)
    if (a === 10) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private 172.16.0.0 – 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (a === 192 && b === 0 && c === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 0 && c === 2) return true;
    // 192.88.99.0/24 (6to4 Relay)
    if (a === 192 && b === 88 && c === 99) return true;
    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (a === 198 && b === 51 && c === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (a === 203 && b === 0 && c === 113) return true;
    // 224.0.0.0/4 & 240.0.0.0/4 (Multicast & Reserved 224.0.0.0 - 255.255.255.255)
    if (a >= 224) return true;

    return false;
  }

  if (isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // Unspecified :: or Loopback ::1
    if (lower === '::' || lower === '::1' || lower === '0:0:0:0:0:0:0:0' || lower === '0:0:0:0:0:0:0:1') {
      return true;
    }
    // Unique Local (fc00::/7 -> fc.. or fd..)
    if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;
    // Link-local (fe80::/10 -> fe8.., fe9.., fea.., feb..)
    if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
    // Multicast (ff00::/8)
    if (/^ff[0-9a-f]{2}:/i.test(lower)) return true;
    // Documentation (2001:db8::/32)
    if (lower.startsWith('2001:db8:')) return true;
    // Discard (100::/64)
    if (lower.startsWith('100:')) return true;
    // IPv4-translated (64:ff9b::/96)
    if (lower.startsWith('64:ff9b:')) return true;

    return false;
  }

  // If not valid IPv4/IPv6, treat as unsafe
  return true;
}

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD' | 'POST';
  timeout?: number;
  maxRedirects?: number;
  maxSize?: number;
  headers?: Record<string, string>;
  body?: string | Buffer | undefined;
}

export interface SafeFetchResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  finalUrl: string;
}

/**
 * Hardened outbound HTTP client with SSRF protections.
 * - http/https only
 * - private/reserved IP block
 * - DNS rebinding protection (verify IP before AND during connection)
 * - redirect validation (re-validate each hop)
 * - timeout + response-size limits
 */
export async function safeFetch(
  urlInput: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  return withSpan(
    'safeFetch',
    async () => {
      return safeFetchInner(urlInput, options);
    },
    {
      'http.method': options.method || 'GET',
      // Never record query strings or fragments: they can carry secrets.
      'url.full': urlInput.split('?')[0],
    }
  );
}

async function safeFetchInner(
  urlInput: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const { method = 'GET', timeout = 10000, maxRedirects = 5, maxSize = 1048576 } = options;
  let currentUrl = urlInput;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(currentUrl);
    } catch {
      throw new SafeFetchError('INVALID_URL', 'Invalid URL');
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new SafeFetchError('UNSAFE_PROTOCOL', 'Only http/https protocols are allowed');
    }

    const hostname = parsedUrl.hostname;

    // DNS resolution + private IP check (rebinding guard part 1)
    let addresses: string[];
    try {
      const result = await lookup(hostname, { all: true });
      addresses = result.map((a) => a.address);
    } catch {
      throw new SafeFetchError('DNS_RESOLUTION_FAILED', `Failed to resolve ${hostname}`);
    }

    if (addresses.length === 0) {
      throw new SafeFetchError('DNS_RESOLUTION_FAILED', `No DNS records for ${hostname}`);
    }

    for (const ip of addresses) {
      if (isPrivateIP(ip)) {
        throw new SafeFetchError('BLOCKED_PRIVATE_IP', `Resolved to private/reserved IP range: ${ip}`);
      }
    }

    // Perform the request with an IP guard on the socket (rebinding guard part 2)
    const isHttps = parsedUrl.protocol === 'https:';
    const fn = isHttps ? httpsRequest : httpRequest;
    const port = parsedUrl.port || (isHttps ? 443 : 80);
    const bodyChunks: Buffer[] = [];

    const result = await new Promise<SafeFetchResult>((resolve, reject) => {
      const req = fn(
        {
          hostname: hostname,
          port: parseInt(String(port), 10),
          path: parsedUrl.pathname + parsedUrl.search,
          method,
          headers: options.headers || {},
          timeout,
        },
        (res) => {
          // Redirect handling
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.destroy();
            // Never follow redirects for POST (credential/body leakage risk);
            // treat as terminal response.
            if (method === 'POST') {
              reject(new SafeFetchError('UNSAFE_REDIRECT', 'Redirects are not allowed for POST requests'));
              return;
            }
            redirectCount++;
            if (redirectCount > maxRedirects) {
              reject(new SafeFetchError('TOO_MANY_REDIRECTS', `Exceeded ${maxRedirects} redirects`));
              return;
            }
            const nextUrl = new URL(res.headers.location, currentUrl).href;
            resolve({
              status: res.statusCode,
              headers: res.headers as Record<string, string | string[] | undefined>,
              body: Buffer.alloc(0),
              finalUrl: nextUrl,
            });
            return;
          }

          let totalSize = 0;
          let aborted = false;

          res.on('data', (chunk: Buffer) => {
            if (aborted) return;
            totalSize += chunk.length;
            if (totalSize > maxSize) {
              aborted = true;
              res.destroy();
              reject(new SafeFetchError('RESPONSE_TOO_LARGE', `Response exceeded ${maxSize} bytes`));
              return;
            }
            bodyChunks.push(chunk);
          });

          res.on('end', () => {
            if (!aborted) {
              resolve({
                status: res.statusCode || 0,
                headers: res.headers as Record<string, string | string[] | undefined>,
                body: Buffer.concat(bodyChunks),
                finalUrl: currentUrl,
              });
            }
          });

          res.on('error', (err) => {
            reject(new SafeFetchError('FETCH_FAILED', err.message));
          });
        }
      );

      // DNS rebinding guard: check the socket's remote IP after connect
      req.on('socket', (socket: Socket) => {
        socket.on('connect', () => {
          const remoteIP = socket.remoteAddress;
          if (remoteIP && isPrivateIP(remoteIP)) {
            socket.destroy();
            req.destroy();
            reject(new SafeFetchError('BLOCKED_PRIVATE_IP', `Connected to private IP: ${remoteIP}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new SafeFetchError('TIMEOUT', `Request timed out after ${timeout}ms`));
      });

      req.on('error', (err) => {
        reject(new SafeFetchError('FETCH_FAILED', err.message));
      });

      if (options.body !== undefined) {
        req.write(options.body);
      }
      req.end();
    });

    // If we got a redirect (body is empty and 3xx), follow it
    if (result.status >= 300 && result.status < 400 && bodyChunks.length === 0) {
      currentUrl = result.finalUrl;
      continue;
    }

    return result;
  }

  throw new SafeFetchError('TOO_MANY_REDIRECTS', `Exceeded ${maxRedirects} redirects`);
}

export function isSafeUrl(urlInput: string): boolean {
  try {
    const parsed = new URL(urlInput);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    let hostname = parsed.hostname.toLowerCase();
    // Strip surrounding brackets for IPv6 literals
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1);
    }
    // Strip trailing dot (FQDN form, e.g. 'localhost.')
    hostname = hostname.replace(/\.$/, '');

    // Block obvious local hostnames
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return false;
    }

    // If hostname is an IP address, test if private
    if (isIP(hostname)) {
      if (isPrivateIP(hostname)) return false;
    }

    return true;
  } catch {
    return false;
  }
}

