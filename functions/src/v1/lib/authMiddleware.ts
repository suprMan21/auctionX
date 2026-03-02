import type { Request, Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";

/**
 * Attach authenticated user to request
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    claims: Record<string, any>;
  };
}

/**
 * Verify Firebase ID token and attach user to request
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Missing or invalid token" });
      return;
    }

    const token = authHeader.substring(7);
    const decodedToken = await getAuth().verifyIdToken(token);
    
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      claims: decodedToken,
    };
    
    next();
  } catch (error) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid token" });
  }
}

/**
 * Require specific custom claims
 */
export function requireRole(...roles: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Not authenticated" });
      return;
    }

    const hasRole = roles.some(role => req.user!.claims[role] === true);
    if (!hasRole) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions" });
      return;
    }

    next();
  };
}

/**
 * Optional auth - attach user if token present, but don't require it
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const decodedToken = await getAuth().verifyIdToken(token);
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        claims: decodedToken,
      };
    }
  } catch (error) {
    // Ignore auth errors for optional auth
  }
  next();
}
