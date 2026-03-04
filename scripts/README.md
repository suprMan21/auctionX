# AuctionX Staging Test Suite

Self-contained smoke, visual, and AI design-review tests targeting live staging infrastructure.

## Staging URLs

| Service  | URL                                            |
|----------|------------------------------------------------|
| Frontend | `https://d1bwev65w7rqzl.cloudfront.net`        |
| Backend  | `https://vw7zy9mkyg.us-east-2.awsapprunner.com` |

## Setup

```bash
cd unmentionables/Unmen/scripts
npm install
npx playwright install chromium
cp .env.example .env   # fill in values
```

## Usage

```bash
# Run all tests (smoke + visual), then prompt for design review
npx tsx run-tests.ts --mode both

# Smoke tests only (routes + API health)
npx tsx run-tests.ts --mode smoke
npm run smoke

# Visual tests only (screenshots + axe accessibility)
npx tsx run-tests.ts --mode visual
npm run visual

# Run Playwright directly
npx playwright test --project smoke
npx playwright test --project visual
```

## Environment Variables

| Variable                  | Required | Default                                          | Description                              |
|---------------------------|----------|--------------------------------------------------|------------------------------------------|
| `PLAYWRIGHT_BASE_URL`     | No       | `https://d1bwev65w7rqzl.cloudfront.net`          | Frontend base URL                        |
| `PLAYWRIGHT_BACKEND_URL`  | No       | `https://vw7zy9mkyg.us-east-2.awsapprunner.com` | Backend API base URL                     |
| `PLAYWRIGHT_TEST_EMAIL`   | No       | —                                                | Test account email (auth flow tests)     |
| `PLAYWRIGHT_TEST_PASSWORD`| No       | —                                                | Test account password (auth flow tests)  |
| `ANTHROPIC_API_KEY`       | No*      | —                                                | Required for AI design review            |

*Only needed when opting into the design review step.

## Output

| File/Directory                     | Contents                                      |
|------------------------------------|-----------------------------------------------|
| `reports/smoke-{ts}.json`          | Playwright JSON report (smoke run)            |
| `reports/visual-{ts}/`             | Playwright HTML report (visual run)           |
| `reports/screenshots/`             | Fullpage + viewport PNGs per route            |
| `reports/axe-{ts}.json`            | Aggregated axe-core WCAG 2.2 AA report        |
| `../DESIGN_SUGGESTIONS.md`         | AI design suggestions (newest pass first)     |

## Design Review Agent

When running visual tests, you'll be prompted to run the AI design review agent.
The agent:
1. Reads the latest axe accessibility report
2. Samples up to 60 frontend source files
3. Encodes up to 5 screenshots as base64
4. Calls Claude (`claude-sonnet-4-6`) with vision + code context
5. Applies any suggested file changes to a new `design-review/{timestamp}` branch
6. Appends a structured pass to `DESIGN_SUGGESTIONS.md`

Requires `ANTHROPIC_API_KEY` to be set.
