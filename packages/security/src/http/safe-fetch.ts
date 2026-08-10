import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { Socket } from 'node:net';

export class SafeFetchError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^fd/i,
  /^::$/,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./i, // Carrier-grade NAT
  /^2[23]\./, // CGNAT range
];

function isPrivateIP(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(ip));
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
          const remoteIP = socket.remoteAddress?.replace(/^::ffff:/, '');
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
    // Block obvious localhost / IP literals without DNS
    const hostname = parsed.hostname;
    if (isPrivateIP(hostname)) return false;
    if (hostname === 'localhost') return false;
    return true;
  } catch {
    return false;
  }
}
