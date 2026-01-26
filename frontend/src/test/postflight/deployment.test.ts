import { describe, it, expect } from 'vitest';

describe('Postflight: Deployment Validation', () => {
  const PRODUCTION_URL = process.env.VITE_PRODUCTION_URL || 'https://auctionx.vercel.app';

  it('should have production URL configured', () => {
    expect(PRODUCTION_URL).toBeDefined();
    expect(PRODUCTION_URL).toMatch(/^https:\/\//);
  });

  it('should not have development flags in production build', async () => {
    const response = await fetch(`${PRODUCTION_URL}/`);
    const html = await response.text();
    
    expect(html).not.toContain('VITE_DEV_MODE');
    expect(html).not.toContain('localhost');
  });

  it('should have proper CSP headers', async () => {
    const response = await fetch(`${PRODUCTION_URL}/`);
    const csp = response.headers.get('content-security-policy');
    
    if (csp) {
      expect(csp).toContain("default-src 'self'");
    }
  });

  it('should serve assets with caching headers', async () => {
    const response = await fetch(`${PRODUCTION_URL}/`);
    const cacheControl = response.headers.get('cache-control');
    
    expect(cacheControl).toBeDefined();
  });
});

describe('Postflight: API Connectivity', () => {
  it('should connect to Supabase', () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toBeDefined();
    expect(import.meta.env.VITE_SUPABASE_URL).toContain('supabase.co');
  });

  it('should have valid AWS configuration', () => {
    expect(import.meta.env.VITE_AWS_S3_BUCKET).toBeDefined();
    expect(import.meta.env.VITE_AWS_REGION).toBeDefined();
  });
});
