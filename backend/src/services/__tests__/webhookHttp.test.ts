import { EventEmitter } from 'node:events';
import type { ClientRequest, RequestOptions, IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

const mockLookup = jest.fn();
const mockHttpRequest = jest.fn();
const mockHttpsRequest = jest.fn();
jest.unstable_mockModule('node:dns/promises', () => ({ lookup: mockLookup }));
jest.unstable_mockModule('node:http', () => ({ request: mockHttpRequest }));
jest.unstable_mockModule('node:https', () => ({ request: mockHttpsRequest }));

const { postWebhook } = await import('../webhookHttp.js');
const { resolvePublicAddress } = await import('../../utils/webhookUrlSecurity.js');

describe('postWebhook', () => {
  afterEach(() => {
    mockLookup.mockReset();
    mockHttpRequest.mockReset();
    mockHttpsRequest.mockReset();
  });

  it('pins the HTTPS connection to the validated DNS answer', async () => {
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    let connectedAddress: string | undefined;

    mockHttpsRequest.mockImplementation((...args: unknown[]) => {
      const options = args[1] as RequestOptions;
      const callback = args[2] as (response: IncomingMessage) => void;
      const request = new EventEmitter() as ClientRequest;
      request.end = (() => {
        const lookup = options.lookup as LookupFunction;
        lookup(
          'rebind.example',
          { family: 0, hints: 0, all: false, verbatim: false },
          (_error, address) => {
            connectedAddress = typeof address === 'string' ? address : address[0]?.address;
          },
        );
        callback({
          statusCode: 204,
          resume: jest.fn(),
        } as unknown as IncomingMessage);
        return request;
      }) as ClientRequest['end'];
      return request;
    });

    await expect(
      postWebhook(
        'https://rebind.example/hook',
        '{}',
        { 'content-type': 'application/json' },
        1000,
      ),
    ).resolves.toEqual({ ok: true, status: 204 });
    expect(connectedAddress).toBe('8.8.8.8');
  });

  it('refuses a private DNS answer before opening a socket', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      postWebhook(
        'https://rebind.example/hook',
        '{}',
        { 'content-type': 'application/json' },
        1000,
      ),
    ).rejects.toThrow('non-public address');
    expect(mockHttpsRequest).not.toHaveBeenCalled();
  });

  it('refuses delivery when DNS rebounds to a private address after registration', async () => {
    // Registration-time check resolves a public address and passes…
    mockLookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    await expect(resolvePublicAddress('rebind.example')).resolves.toEqual({
      address: '8.8.8.8',
      family: 4,
    });

    // …then the record is repointed at a link-local address before delivery.
    mockLookup.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    await expect(
      postWebhook(
        'https://rebind.example/hook',
        '{}',
        { 'content-type': 'application/json' },
        1000,
      ),
    ).rejects.toThrow('non-public address');
    expect(mockHttpsRequest).not.toHaveBeenCalled();
  });

  it('refuses a 3xx redirect instead of following it to another address', async () => {
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);

    const resume = jest.fn();
    mockHttpsRequest.mockImplementation((...args: unknown[]) => {
      const callback = args[2] as (response: IncomingMessage) => void;
      const request = new EventEmitter() as ClientRequest;
      request.end = (() => {
        callback({
          statusCode: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
          resume,
        } as unknown as IncomingMessage);
        return request;
      }) as ClientRequest['end'];
      return request;
    });

    await expect(
      postWebhook(
        'https://redirect.example/hook',
        '{}',
        { 'content-type': 'application/json' },
        1000,
      ),
    ).rejects.toThrow(/redirect/i);
    // The rejected response is still drained so the socket can be reused.
    expect(resume).toHaveBeenCalledTimes(1);
    // Only the original (validated) URL was ever contacted.
    expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    [200, true],
    [204, true],
    [299, true],
    [199, false],
    [401, false],
    [503, false],
  ])('maps HTTP %i to ok=%s and drains the response', async (status, ok) => {
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);

    const resume = jest.fn();
    let sentBody: unknown;
    mockHttpsRequest.mockImplementation((...args: unknown[]) => {
      const callback = args[2] as (response: IncomingMessage) => void;
      const request = new EventEmitter() as ClientRequest;
      request.end = ((body: string) => {
        sentBody = body;
        callback({ statusCode: status, resume } as unknown as IncomingMessage);
        return request;
      }) as ClientRequest['end'];
      return request;
    });

    await expect(
      postWebhook('https://status.example/hook', '{"event":"x"}', {}, 1000),
    ).resolves.toEqual({ ok, status });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(sentBody).toBe('{"event":"x"}');
  });

  it('aborts the request when the timeout elapses and clears the timer', async () => {
    jest.useFakeTimers();
    try {
      mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);

      let signal: AbortSignal | undefined;
      let request: ClientRequest | undefined;
      mockHttpsRequest.mockImplementation((...args: unknown[]) => {
        const options = args[1] as RequestOptions;
        signal = options.signal as AbortSignal;
        const req = new EventEmitter() as ClientRequest;
        req.end = (() => req) as ClientRequest['end'];
        signal.addEventListener('abort', () => {
          req.emit('error', new Error('The operation was aborted'));
        });
        request = req;
        return req;
      });

      const pending = postWebhook(
        'https://slow.example/hook',
        '{}',
        { 'content-type': 'application/json' },
        1000,
      );
      const rejection = expect(pending).rejects.toThrow('The operation was aborted');

      await jest.advanceTimersByTimeAsync(0);
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal!.aborted).toBe(false);
      expect(request).toBeDefined();

      await jest.advanceTimersByTimeAsync(1000);
      await rejection;

      expect(signal!.aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears the timeout on both response and transport-error paths', async () => {
    jest.useFakeTimers();
    try {
      mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);

      mockHttpsRequest.mockImplementation((...args: unknown[]) => {
        const callback = args[2] as (response: IncomingMessage) => void;
        const request = new EventEmitter() as ClientRequest;
        request.end = (() => {
          callback({ statusCode: 200, resume: jest.fn() } as unknown as IncomingMessage);
          return request;
        }) as ClientRequest['end'];
        return request;
      });

      await expect(postWebhook('https://ok.example/hook', '{}', {}, 1000)).resolves.toEqual({
        ok: true,
        status: 200,
      });
      expect(jest.getTimerCount()).toBe(0);

      mockHttpsRequest.mockImplementation((...args: unknown[]) => {
        void args;
        const request = new EventEmitter() as ClientRequest;
        request.end = (() => {
          request.emit('error', new Error('socket hang up'));
          return request;
        }) as ClientRequest['end'];
        return request;
      });

      await expect(postWebhook('https://broken.example/hook', '{}', {}, 1000)).rejects.toThrow(
        'socket hang up',
      );
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses the HTTP transport and pins all-address lookups for HTTP callbacks', async () => {
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);

    let pinnedAddresses: unknown;
    mockHttpRequest.mockImplementation((...args: unknown[]) => {
      const options = args[1] as RequestOptions;
      const callback = args[2] as (response: IncomingMessage) => void;
      const request = new EventEmitter() as ClientRequest;
      request.end = (() => {
        const lookup = options.lookup as LookupFunction;
        lookup(
          'plain.example',
          { family: 0, hints: 0, all: true, verbatim: false },
          (_error, addresses) => {
            pinnedAddresses = addresses;
          },
        );
        callback({ statusCode: 200, resume: jest.fn() } as unknown as IncomingMessage);
        return request;
      }) as ClientRequest['end'];
      return request;
    });

    await expect(postWebhook('http://plain.example/hook', '{}', {}, 1000)).resolves.toEqual({
      ok: true,
      status: 200,
    });
    expect(mockHttpRequest).toHaveBeenCalledTimes(1);
    expect(mockHttpsRequest).not.toHaveBeenCalled();
    expect(pinnedAddresses).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });
});
