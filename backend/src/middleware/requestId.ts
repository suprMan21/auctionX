import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export interface RequestWithId extends Request {
  requestId: string;
}

export const requestIdMiddleware = (req: RequestWithId, res: Response, next: NextFunction) => {
  req.requestId = req.headers['x-request-id'] as string || randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};
