import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  windowStart: number;
  blockedUntil?: number;
}

// In-memory store — sufficient for single-instance MVP, swap for Redis if scaling
const store = new Map<string, RateLimitEntry>();

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  blockDurationMs: number;
}

// Tiered limits based on action severity
const PROFILES: Record<string, RateLimitConfig> = {
  // Destructive: suspend, ban, unban — tight
  destructive: {
    windowMs: 60_000,
    maxRequests: 10,
    blockDurationMs: 300_000  // 5 min block
  },
  // Reads — generous
  read: {
    windowMs: 60_000,
    maxRequests: 120,
    blockDurationMs: 60_000
  },
  // Everything else
  default: {
    windowMs: 60_000,
    maxRequests: 30,
    blockDurationMs: 120_000
  }
};

function getProfile(req: Request): RateLimitConfig {
  if (req.method === 'GET') return PROFILES.read;

  const path = req.path.toLowerCase();
  if (path.includes('/suspend') || path.includes('/ban') || path.includes('/unban')) {
    return PROFILES.destructive;
  }

  return PROFILES.default;
}

export const adminRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  // Must run after verifyAdminAuth so req.admin is populated
  if (!req.admin) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const profile = getProfile(req);
  // Key: per admin, per method, per path — prevents one admin from DOSing specific actions
  const key = `${req.admin.admin_id}:${req.method}:${req.path}`;
  const now = Date.now();

  let entry = store.get(key);

  // Check if currently blocked
  if (entry?.blockedUntil) {
    if (now < entry.blockedUntil) {
      const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'Rate limit exceeded. Try again later.',
        code: 'RATE_LIMITED',
        retryAfterSeconds: retryAfter
      });
      return;
    }
    // Block expired — reset
    store.delete(key);
    entry = undefined;
  }

  if (!entry || now - entry.windowStart > profile.windowMs) {
    entry = { count: 1, windowStart: now };
  } else {
    entry.count++;

    if (entry.count > profile.maxRequests) {
      entry.blockedUntil = now + profile.blockDurationMs;
      store.set(key, entry);

      console.warn(
        `[rateLimit] Admin ${req.admin.email} blocked — ` +
        `exceeded ${profile.maxRequests} req/min on ${req.method} ${req.path}`
      );

      const retryAfter = Math.ceil(profile.blockDurationMs / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'Rate limit exceeded. Try again later.',
        code: 'RATE_LIMITED',
        retryAfterSeconds: retryAfter
      });
      return;
    }
  }

  res.set('X-RateLimit-Limit', String(profile.maxRequests));
  res.set('X-RateLimit-Remaining', String(Math.max(0, profile.maxRequests - entry.count)));
  res.set('X-RateLimit-Reset', String(Math.ceil((entry.windowStart + profile.windowMs) / 1000)));

  store.set(key, entry);
  next();
};

// Prevent memory leak — prune stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    const expired = !entry.blockedUntil && now - entry.windowStart > 600_000;
    const blockExpired = entry.blockedUntil && now > entry.blockedUntil;
    if (expired || blockExpired) store.delete(key);
  }
}, 600_000);
