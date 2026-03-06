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
