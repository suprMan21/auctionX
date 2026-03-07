import { Request, Response, NextFunction } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Singleton clients — don't create new ones per request
const supabaseAnon: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const supabaseService: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface AdminUser {
  admin_id: string;
  email: string;
  role: string;
  permissions: string[];
  brand: 'auctionx' | 'unmentionables' | 'both';
  session_version: number;
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminUser;
    }
  }
}

export const verifyAdminAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No authorization token provided' });
      return;
    }

    const token = authHeader.substring(7);

    // 1. Verify JWT — differentiate expired vs invalid for frontend handling
    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token);

    if (authError) {
      const isExpired = authError.message?.toLowerCase().includes('expired');
      res.status(401).json({
        error: isExpired ? 'Token expired' : 'Invalid token',
        code: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'
      });
      return;
    }

    if (!user) {
      res.status(401).json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' });
      return;
    }

    // 2. Check admin_users with service key (bypasses RLS chicken-egg)
    //    Also fetches session_version for zero trust check
    const { data: adminData, error: adminError } = await supabaseService
      .from('admin_users')
      .select(`
        admin_id,
        brand,
        is_active,
        session_version,
        admin_roles (
          role_name,
          permissions
        )
      `)
      .eq('admin_id', user.id)
      .eq('is_active', true)
      .single();

    if (adminError || !adminData) {
      res.status(403).json({ error: 'User is not an admin', code: 'FORBIDDEN' });
      return;
    }

    // 3. Zero trust: session revocation check
    //    Get token issued-at from JWT. If token was issued before session_version,
    //    it has been invalidated — reject even though the JWT itself is still valid.
    if (adminData.session_version > 0) {
      // Decode iat from JWT payload without re-verifying (already verified above)
      const payloadBase64 = token.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
      const tokenIssuedAt: number = payload.iat ?? 0;

      if (tokenIssuedAt < adminData.session_version) {
        res.status(401).json({
          error: 'Session has been invalidated. Please log in again.',
          code: 'SESSION_REVOKED'
        });
        return;
      }
    }

    // 4. Attach verified admin context to request
    // Supabase returns the join as a single object (many-to-one FK), not an array
    // Supabase types say array but runtime returns object for many-to-one FK joins
    const rawRole = adminData.admin_roles as unknown;
    const adminRole = Array.isArray(rawRole) ? rawRole[0] : rawRole as { role_name: string; permissions: string[] } | null;
    req.admin = {
      admin_id: adminData.admin_id,
      email: user.email!,
      role: adminRole?.role_name ?? '',
      permissions: adminRole?.permissions ?? [],
      brand: adminData.brand,
      session_version: adminData.session_version
    };

    // 5. Update last_active_at (fire-and-forget, non-blocking)
    supabaseService
      .from('admin_users')
      .update({ last_active_at: new Date().toISOString() })
      .eq('admin_id', user.id)
      .then(() => {}, (err: unknown) => console.error('[adminAuth] last_active_at update failed:', err));

    next();
  } catch (error) {
    console.error('[adminAuth] Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Permission guard — unchanged from original, just typed properly
export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!req.admin.permissions.includes(permission)) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: permission,
        have: req.admin.permissions
      });
      return;
    }

    next();
  };
};

// Brand guard — unchanged from original
export const requireBrandAccess = (brand: 'auctionx' | 'unmentionables') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (req.admin.brand !== 'both' && req.admin.brand !== brand) {
      res.status(403).json({
        error: 'Brand access denied',
        required: brand,
        have: req.admin.brand
      });
      return;
    }

    next();
  };
};
