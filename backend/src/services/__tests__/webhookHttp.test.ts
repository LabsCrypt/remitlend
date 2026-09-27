import { EventEmitter } from 'node:events';
import type { ClientRequest, RequestOptions, IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

const mockLookup = jest.fn();
const mockHttpsRequest = jest.fn();
jest.unstable_mockModule('node:dns/promises', () => ({ lookup: mockLookup }));
jest.unstable_mockModule('node:https', () => ({ request: mockHttpsRequest }));

const { postWebhook } = await import('../webhookHttp.js');

describe('postWebhook', () => {
  afterEach(() => {
    mockLookup.mockReset();
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
});
