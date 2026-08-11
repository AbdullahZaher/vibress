import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return { ...actual, lookup: vi.fn() };
});

import { safeFetch, isPrivateIP } from '../http/safe-fetch';
import { lookup as mockedLookup } from 'node:dns/promises';

const mockLookup = vi.mocked(mockedLookup);

afterEach(() => {
  mockLookup.mockReset();
});

describe('SSRF Integration — DNS Rebinding & Redirect Defense', () => {
  it('blocks DNS rebinding: pre-check sees public IP but socket connects to private', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('internal-data-leaked');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;

    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as any);

    try {
      await expect(safeFetch(`http://localhost:${port}/`)).rejects.toThrow(
        /BLOCKED_PRIVATE_IP|private/i,
      );
    } finally {
      server.close();
    }
  });

  it('blocks redirect-to-private: real redirect server targeting cloud metadata', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/' });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;

    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(
      /BLOCKED_PRIVATE_IP|private/i,
    );

    server.close();
  });

  it('blocks DNS-rebinding redirect chain: spoofed DNS → local redirect → private target', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { Location: 'http://10.0.0.1/admin/secrets' });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;

    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as any);

    try {
      await expect(safeFetch(`http://localhost:${port}/`)).rejects.toThrow(
        /BLOCKED_PRIVATE_IP|private/i,
      );
    } finally {
      server.close();
    }

    mockLookup.mockReset();
    await expect(safeFetch('http://10.0.0.1/admin/secrets')).rejects.toThrow(
      /BLOCKED_PRIVATE_IP|private/i,
    );
  });

  it('verifies cloud metadata and private redirect targets are blocked', () => {
    expect(isPrivateIP('169.254.169.254')).toBe(true);
    expect(isPrivateIP('100.100.100.200')).toBe(true);
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('192.168.1.1')).toBe(true);
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('0.0.0.0')).toBe(true);
    expect(isPrivateIP('::1')).toBe(true);
  });
});
