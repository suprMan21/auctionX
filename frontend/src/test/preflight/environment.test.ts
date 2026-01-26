import { describe, it, expect } from 'vitest';

describe('Preflight: Environment Variables', () => {
  it('should have VITE_SUPABASE_URL defined', () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toBeDefined();
    expect(import.meta.env.VITE_SUPABASE_URL).toContain('supabase');
  });

  it('should have VITE_SUPABASE_ANON_KEY defined', () => {
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY).toBeDefined();
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY.length).toBeGreaterThanOrEqual(20);
  });

  it('should have VITE_AWS_S3_BUCKET defined', () => {
    expect(import.meta.env.VITE_AWS_S3_BUCKET).toBeDefined();
    expect(import.meta.env.VITE_AWS_S3_BUCKET).toContain('auctionx');
  });

  it('should have VITE_AWS_REGION defined', () => {
    expect(import.meta.env.VITE_AWS_REGION).toBeDefined();
  });
});

describe('Preflight: Node Environment', () => {
  it('should have Node.js installed', () => {
    expect(process.version).toBeDefined();
    expect(process.version).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it('should be running Node 18 or higher', () => {
    const version = parseInt(process.version.slice(1).split('.')[0]);
    expect(version).toBeGreaterThanOrEqual(18);
  });
});
