import { Request, Response, NextFunction } from 'express';
import type { User } from '@supabase/supabase-js';
import { verifyAuthToken } from '../lib/supabase';
import { getAccountStatus } from '../lib/security/accountStatus';

export interface AuthRequest extends Request {
  user?: User;
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let user: User;
  try {
    user = await verifyAuthToken(req.headers.authorization);
  } catch (error) {
    res.status(401).json({ success: false, data: null, error: 'Unauthorized' });
    return;
  }

  // S-ADMIN2: a suspended or retired account cannot act, even with a token
  // issued before the action. Fails closed if the status cannot be read.
  const status = await getAccountStatus(user.id);
  if (status === null) {
    res.status(503).json({ success: false, data: null, error: 'Service temporarily unavailable', code: 'unavailable' });
    return;
  }
  if (status !== 'active') {
    res.status(403).json({ success: false, data: null, error: 'This account is not active', code: 'account_inactive' });
    return;
  }

  req.user = user;
  next();
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
