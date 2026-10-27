import { Request, Response, NextFunction } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getAccountStatus } from '../lib/security/accountStatus';
import { sessionHasSecondFactor } from '../lib/security/twoFactorGate';
import { isAdminTwoFactorRequired } from '../lib/featureFlags';
import type { AdminPermission } from '../lib/admin/permissions';

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
      res.status(401).json({ error: 'Your session has ended. Sign in again.' });
      return;
    }

    const token = authHeader.substring(7);

    // 1. Verify JWT — differentiate expired vs invalid for frontend handling
    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token);

    if (authError) {
      const isExpired = authError.message?.toLowerCase().includes('expired');
      res.status(401).json({
        error: 'Your session has ended. Sign in again.',
        code: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'
      });
      return;
    }

    if (!user) {
      res.status(401).json({ error: 'Your session has ended. Sign in again.', code: 'UNAUTHENTICATED' });
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
      res.status(403).json({ error: 'This account does not have staff access.', code: 'FORBIDDEN' });
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
          error: 'Your session has ended. Sign in again.',
          code: 'SESSION_REVOKED'
        });
        return;
      }
    }

    // 4. S-ADMIN2: a suspended account keeps its admin_users row but may not
    //    act (retire also turns the row off). Fails closed.
    const status = await getAccountStatus(user.id);
    if (status !== 'active') {
      res.status(status === null ? 503 : 403).json({
        success: false,
        data: null,
        error: status === null ? 'Service temporarily unavailable' : 'This account is not active',
        code: status === null ? 'UNAVAILABLE' : 'ACCOUNT_INACTIVE'
      });
      return;
    }

    // 5. S-ADMIN2 AC 5: admin routes need this session to have passed its
    //    second factor (S-2FA marker) once FEATURE_REQUIRE_ADMIN_2FA is on.
    //    Off until every admin has a passkey (S-2FA Ph4). Fails closed.
    if (isAdminTwoFactorRequired() && !(await sessionHasSecondFactor(authHeader, user.id))) {
      res.status(403).json({
        success: false,
        data: null,
        error: 'Admin access needs two-factor sign-in',
        code: 'ADMIN_2FA_REQUIRED'
      });
      return;
    }

    // 6. Attach verified admin context to request
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

    // 7. Update last_active_at (fire-and-forget, non-blocking)
    supabaseService
      .from('admin_users')
      .update({ last_active_at: new Date().toISOString() })
      .eq('admin_id', user.id)
      .then(() => {}, (err: unknown) => console.error('[adminAuth] last_active_at update failed:', err));

    next();
  } catch (error) {
    console.error('[adminAuth] Unexpected error:', error);
    res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
  }
};

// Permission guard. Every admin route gates on a permission (S-ADMIN2 AC 9).
export const requirePermission = (permission: AdminPermission) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ success: false, data: null, error: 'Your session has ended. Sign in again.', code: 'UNAUTHENTICATED' });
      return;
    }

    // The response never lists the admin's permissions (S-ADMIN2).
    if (!req.admin.permissions.includes(permission)) {
      res.status(403).json({ success: false, data: null, error: 'Your staff role cannot do this.', code: 'FORBIDDEN' });
      return;
    }

    next();
  };
};

// Brand guard — unchanged from original
export const requireBrandAccess = (brand: 'auctionx' | 'unmentionables') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ error: 'Your session has ended. Sign in again.' });
      return;
    }

    if (req.admin.brand !== 'both' && req.admin.brand !== brand) {
      res.status(403).json({ success: false, data: null, error: 'Your staff role cannot do this.', code: 'FORBIDDEN' });
      return;
    }

    next();
  };
};
