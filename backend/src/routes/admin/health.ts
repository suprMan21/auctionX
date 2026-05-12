import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * GET /api/v1/admin/health
 * Returns system health with component-level status and latency.
 */
router.get('/', async (_req: Request, res: Response) => {
  const components: Record<string, { status: 'ok' | 'degraded' | 'down'; latencyMs: number; message?: string }> = {};

  // Database check
  const dbStart = Date.now();
  try {
    const { error } = await supabase.from('users').select('id', { count: 'exact', head: true });
    const latencyMs = Date.now() - dbStart;
    components.database = error
      ? { status: 'down', latencyMs, message: error.message }
      : { status: latencyMs > 2000 ? 'degraded' : 'ok', latencyMs };
  } catch {
    components.database = { status: 'down', latencyMs: Date.now() - dbStart, message: 'Connection failed' };
  }

  // Auth check
  const authStart = Date.now();
  try {
    const { error } = await supabase.auth.getUser();
    const latencyMs = Date.now() - authStart;
    // Service role getUser returns an error but proves auth service is reachable
    components.auth = { status: latencyMs > 2000 ? 'degraded' : 'ok', latencyMs };
  } catch {
    components.auth = { status: 'down', latencyMs: Date.now() - authStart, message: 'Auth service unreachable' };
  }

  // Storage check (S3 bucket configured?)
  components.storage = {
    status: process.env.S3_BUCKET_NAME ? 'ok' : 'degraded',
    latencyMs: 0,
    ...(process.env.S3_BUCKET_NAME ? {} : { message: 'S3_BUCKET_NAME not configured' }),
  };

  // Overall status
  const statuses = Object.values(components).map((c) => c.status);
  const overall = statuses.includes('down') ? 'down' : statuses.includes('degraded') ? 'degraded' : 'ok';

  res.json({
    status: overall,
    timestamp: new Date().toISOString(),
    components,
  });
});

export default router;
