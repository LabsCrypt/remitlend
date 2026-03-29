import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

interface RequestContext {
  requestId: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const createRequestId = (): string => randomUUID();

export const runWithRequestContext = <T>(
  requestId: string,
  callback: () => T,
): T => {
  return requestContextStorage.run({ requestId }, callback);
};

export const getRequestId = (): string | undefined => {
  return requestContextStorage.getStore()?.requestId;
};
