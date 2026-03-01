import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const auditLog = (action: string, entityType: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);
    
    res.send = function (data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.admin) {
        const entityId = req.params.id || req.params.userId || req.params.listingId || req.body?.id;
        
        supabase.from('audit_logs').insert({
          admin_id: req.admin.admin_id,
          admin_email: req.admin.email,
          action,
          entity_type: entityType,
          entity_id: entityId,
          changes: req.body || null,
          reason: req.body?.reason || null,
          ip_address: req.ip,
          user_agent: req.get('user-agent'),
          brand: req.admin.brand === 'both' ? 'auctionx' : req.admin.brand
        }).then(
          () => { console.log(`[AUDIT] ${action} on ${entityType}:${entityId} by ${req.admin!.email}`); },
          (err: unknown) => { console.error('[AUDIT] Failed to log:', err); }
        );
      }
      
      return originalSend(data);
    };
    
    next();
  };
};
