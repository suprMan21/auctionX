import { Request, Response, NextFunction } from 'express';
import type { User } from '@supabase/supabase-js';
import { verifyAuthToken } from '../lib/supabase';

export interface AuthRequest extends Request {
  user?: User;
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await verifyAuthToken(req.headers.authorization);
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
  }
};

/**
 * Identifies the caller when a valid bearer token is present; never rejects.
 *
 * For public reads that personalise their answer ("You own this") without
 * gating it. A missing, malformed or expired token is simply anonymous — it
 * must not turn a public page into a 401.
 */
export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  if (req.headers.authorization) {
    try {
      req.user = await verifyAuthToken(req.headers.authorization);
    } catch {
      req.user = undefined;
    }
  }
  next();
};
