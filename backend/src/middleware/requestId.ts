import type { Request, Response, NextFunction } from "express";
import {
  createRequestId,
  runWithRequestContext,
} from "../utils/requestContext.js";

declare module "express" {
  interface Request {
    requestId?: string;
  }
}

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const incomingHeader = req.header("x-request-id");
  const requestId =
    typeof incomingHeader === "string" && incomingHeader.trim().length > 0
      ? incomingHeader.trim()
      : createRequestId();

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  runWithRequestContext(requestId, () => {
    next();
  });
};
