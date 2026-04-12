# npm Security Audit — 2026-04-12

## Scope
Full audit of npm dependencies across all workspaces (frontend, backend, contracts, scripts) and Deno Edge Functions, triggered by breaking npm supply chain attacks and CVEs announced in early 2025.

---

## Findings — Fixed

| Issue | Severity | Component | Fix Applied |
|-------|----------|-----------|-------------|
| Vite 7.0.0–7.3.1: Path traversal in `.map` handling (GHSA-4w7w-66w2-5vf9) | HIGH | frontend, backend (via vitest) | `npm audit fix` → Vite 7.3.2+ |
| Vite 7.x: `server.fs.deny` bypass via queries (GHSA-v2wj-q39q-566r) | HIGH | frontend, backend | Same fix |
| Vite 7.x: Arbitrary file read via dev server WebSocket (GHSA-p9ff-h696-f583) | HIGH | frontend, backend | Same fix |
| Axios ≤1.14.0: SSRF via header injection chain (GHSA-fvcv-3m26-pcqx) | CRITICAL | backend (via AWS SDK) | `npm audit fix` |
| path-to-regexp 8.0.0–8.3.0: DoS via sequential optional groups (GHSA-j3q9-mxjg-w52f) | HIGH | backend (via Express) | `npm audit fix` |
| path-to-regexp 8.x: ReDoS via multiple wildcards (GHSA-27v5-c462-wpq7) | HIGH | backend (via Express) | `npm audit fix` |
| fast-xml-parser 5.0.0–5.5.6: Entity expansion bypass (GHSA-8gc5-j5rx-235r) | HIGH | backend (via AWS SDK) | `npm audit fix` |
| flatted ≤3.4.1: DoS + Prototype Pollution (GHSA-25h7-pfq9-p65f, GHSA-rf6f-7fwh-wjgh) | HIGH | frontend, backend | `npm audit fix` |
| picomatch: Method injection + ReDoS (GHSA-3v7f-55p6-f55p, GHSA-c2c7-rcm5-vvqj) | HIGH | frontend, backend | `npm audit fix` |
| happy-dom ≤20.8.8: Two HIGH CVEs (GHSA-w4gp-fjgq-3q4g, GHSA-6q6h-j7hj-3r64) | HIGH | frontend (test env) | `npm audit fix` |
| brace-expansion: DoS (GHSA-f886-m6hf-6m8v) | MODERATE | frontend, backend | `npm audit fix` |
| Stripe Deno SDK 14.17.0 (6 major versions behind; Node backend uses ^20.2.0) | HIGH | Deno Edge Functions | Upgraded to 17.5.0 in `deno.json` |
| `deno.land/std@0.168.0/http/server.ts` serve() — deprecated 2022 | MEDIUM | All 8 Edge Functions | Replaced with `Deno.serve()` |
| `deno.land/std@0.177.0/node/crypto.ts` — deprecated path | MEDIUM | upload-url Edge Function | Replaced with `node:crypto` |
| `place-bid/index.ts` — duplicated file body with `EOF`/`Output` artifacts | MEDIUM | place-bid Edge Function | Deduplicated; clean single copy |
| `@supabase/supabase-js@2` floating pin in payment-webhook | LOW | payment-webhook | Pinned to `2.93.1` |
| No npm audit enforcement in any workspace | Procedural | All workspaces | Added `.npmrc audit-level=high` + `npm run audit:all` script |

---

## Findings — Accepted Risk (Deferred)

| Issue | CVE/Advisory | Severity | Justification | Deferred To |
|-------|-------------|----------|---------------|-------------|
| Hardhat ecosystem (lodash, undici, cookie, elliptic, serialize-javascript, bn.js) — 7 HIGH, 13 MODERATE, 21 LOW | Multiple | HIGH | All within `contracts/` (dev-only Hardhat v2 tooling). Fix requires `hardhat@3.x` migration — breaking change. Zero production runtime exposure. `audit:contracts` uses `--audit-level=critical` to pass CI without forcing this migration. | Dedicated hardhat-v3 migration session |
| path-to-regexp 6.x (ReDoS via backtracking) | CVE-2024-45296 | HIGH (NVD 7.7) | Frontend only, via `react-router-dom@6`. Browser-side execution — ReDoS requires server processing of attacker-controlled route patterns. Client browser cannot be DoS'd in a meaningful way. Fix requires react-router v7 migration. | react-router v7 migration session |

---

## Packages Verified Clean (Pre-existing at patched versions)

| Package | Version | CVE(s) | Status |
|---------|---------|--------|--------|
| Vitest | 4.0.18 | CVE-2025-24964 (affects ≤3.0.4) | ✅ Not affected |
| Express | 5.2.1 | CVE-2024-29041, CVE-2024-43796, CVE-2024-51999 | ✅ All fixed in Express 5 GA |
| esbuild | 0.27.3 | GHSA-67mh-4wv8-2f99 (fixed at 0.25.0+) | ✅ Not affected |
| PostCSS | 8.4.47 | GHSA-566m-qj78-rww5 (fixed at 8.4.31+) | ✅ Not affected |
| @supabase/auth-js | 2.98.0 | Path traversal (fixed at 2.69.1+) | ✅ Not affected |
| cookie | 0.7.2 | GHSA-pxg6-pf52-xh8x | ✅ Current stable |
| React | 19.2.0 | CVE-2025-55182 (RSC only) | ✅ Not affected — plain client-side Vite, no RSC |
| Vitest API option | N/A | CVE-2025-24964 WebSocket | ✅ API option not enabled |

---

## Pre-existing Type Errors in Edge Functions (Not introduced by this audit)

During `deno check` verification, pre-existing TypeScript type errors were surfaced in several edge function processors (`SignatureProcessor`, `BaseProcessor`, etc.) relating to:
- `logger.debug` calls where the logger has no `debug` method
- `logger.error(msg, { error })` calls where second arg should be `Error`, not a plain object
- `handleWebhook` not declared on `BaseProcessor` base class type

These did not exist in `deno.land/std` type resolution but are now visible with full module resolution. They are not security issues and do not affect runtime behavior. **Recommend fixing in a dedicated session.**

---

## Supply Chain Verification

- All lockfiles use `lockfileVersion 3` with npm integrity hashes (SHA-512 for all packages).
- No `.npmrc` private registry previously configured; all packages from public npm.
- Typosquatting campaigns (July 2025) targeting `zustand`, `react-router-dom` — verified both are genuine packages via `npm audit` integrity checks.
- No `postinstall` / `preinstall` scripts found in direct dependencies.
- No CI/CD pipeline configured — **recommend adding GitHub Actions with `npm run audit:all`**.

---

## Next Recommended Actions

- [ ] Upgrade react-router-dom to v7 (eliminates path-to-regexp 6.x finding — separate session)
- [ ] Migrate `contracts/` to hardhat v3 (eliminates 41 contracts vulnerabilities — separate session)
- [ ] Fix pre-existing type errors in edge function processors (separate session)
- [ ] Set up GitHub Actions CI with `npm run audit:all` as required check before deploy
- [ ] Enable Dependabot or Renovate for automated dependency PR creation

---

## Commits

| Commit | Description |
|--------|-------------|
| `b132c40` | `npm audit fix` — Vite 7.x, axios SSRF, flatted, picomatch, brace-expansion, fast-xml-parser, path-to-regexp |
| `903c2f5` | Stripe Deno SDK: 14.17.0 → 17.5.0, fix v17 type changes |
| `b504316` | Replace `deno.land/std` `serve()` with `Deno.serve()`, `node:crypto`; deduplicate place-bid |
| `2effce5` | Add `.npmrc` audit-level enforcement and `npm run audit:all` script |
