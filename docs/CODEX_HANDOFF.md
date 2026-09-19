# AgentGuard Codex Handoff

## Overall Objective

Evolve the existing single AgentGuard extension into automatic browser-wide, privacy-safe automation intelligence with recoverable sessions, conservative attribution, cross-tab alerts, real delegation/containment controls and enterprise configuration. Full user specification: [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md).

## Current Phase

Phase 5 — Passive debugger intelligence (in progress). Phases 0–4 implemented and validated; sensor activity/correlation is deliberately deferred to the later detector phases.

## Completed

- Existing single-source, single-manifest, single-dist, single-ZIP architecture preserved.
- Prior migration validated 129 unit/integration tests and five real Chromium scenarios; these are the baseline, not completion of the new request.
- Read the full new specification and stored it in this repository.
- Created both mandatory continuation files before substantive implementation.
- Added `src/shared/intelligence.ts`: six truthful control states, separate identity/stack/session/activity/delegation/provider contracts and conservative activity attribution helpers.
- Five new contract tests pass, including unrelated Tab 4 download while only Tab 1 has automation: UNKNOWN attribution, never agent-specific enforcement.
- Audited event-driven monitoring migration and official Chrome content-script/debugger/navigation/notification/command APIs. Competitor source pinned to a4ca981c65254b9e95bfbca2411881720a5c9e81 (0.7.0); reject URL/title-based identity and fallback download attribution.

## In Progress

Phase 4 sessions/history/export/clear, managed retention and durable restart archival are complete: 314 unit/integration tests, TypeScript/build and eight real-browser scenarios pass. Threat model is written with independently reviewed/source-checked boundaries; all main docs reflect current reality. Phase 5 `debugger-intelligence.ts` and dedicated tests are being implemented by automatic_browser_tests agent; root will integrate worker/dashboard/coverage UI. Existing scoring must not change from repeated target observations. No SCAN_TAB API exists.

## Next Exact Task

Finish bounded debugger-target lifecycle module and wire it to each existing shared snapshot and coverage UI. Validate TypeScript/unit/browser tests, then proceed to versioned framework registry/runtime detector upgrades. Root owns all UI. Do not rerun or rewrite completed session work unless a regression appears.

## Files Changed

Added continuity/requirements/parity docs, `src/shared/intelligence.ts`, `tests/intelligence.test.ts`, `src/content/sensor.ts`, `src/background/sensor-messages.ts`, session engine/tests in progress. Modified states through contracts/scoring/policy/monitor/session/UI/tests, browser snapshot adapter/tests, worker, manifest and Vite sensor bundling.

## Architecture Decisions

- Reuse detection/policy/audit/background/React UI modules; never replace the repository.
- One build and artifact for every deployment; managed policy overrides local settings.
- New target states replace human claims, but perform contract migration in tested increments.
- Automatic monitoring requires declared HTTP(S) host access; activeTab is not a monitoring prerequisite. Permission changes follow official API research and consumers.
- No page content/credentials, no hidden uploads, no debugger attach for detection; controller identity remains unknown absent independently trusted evidence.
- Git exists with an unborn HEAD and all baseline files intent-to-add. Preserve that uncommitted baseline; do not reset, commit unrelated files, initialize Git, or force-push.

## Tests Last Run

Previous completed single-build migration, 2026-09-18:

`npm run package` — PASS (TypeScript; 129 unit/integration tests across 12 files; one build; five Playwright scenarios; one ZIP).

`npm run test:e2e` — PASS (five tests independently).

`git diff --check` — PASS.

Phase 2 additive contracts: `env PATH="/opt/homebrew/bin:$PATH" npm run typecheck` — PASS; `env PATH="/opt/homebrew/bin:$PATH" npm test` — 134 passed, 0 failed in 13 files. Build/e2e/package not rerun for new phase yet.

Phase 3 `npm run check` — PASS (TypeScript; 228 unit/integration tests, 15 files; one dist build). Playwright: all six pass (23.1s). Sixth test originally waited for a new Worker object; Chromium reused the target after real context restart. Test now verifies a cleared global sentinel plus all four fresh observations/badges, no UI opened and unpinned state. No timeout increase or removed assertions.

Phase 4 `npm run check` — PASS (TypeScript; 296 unit/integration tests, 16 files; one dist build). Seven expanded browser scenarios are ready but not yet validated against this build.

Final Phase 4 verification: TypeScript, 314 unit/integration tests (16 files), single build, and all eight Playwright scenarios PASS (34.4s), including actual full-browser restart using the same profile. Session store has 81 tests; UI 45. Prior seven-scenario build also passed before adding browser-restart coverage.

## Known Failures

No reproduced failures through Phase 4. Durable session history contains up to configured-count active recovery copies plus configured-count ended records (default50+50, max500+500); zero disables both durable sets. Losing the session journal after a rejected durable end/clear can only recover the last successful durable snapshot; this limit is tested/documented. Sensor activity/correlation, stack/environment sensors, cross-tab alerts, delegation, complete Security Center and real-tool matrix remain pending. Do not ship or call the expanded product complete.

## Manual Tests Required

Real managed Chrome policy, normal headed Chrome versus DevTools, actual Codex/Claude tools, unavailable Selenium/Puppeteer tools until installed/validated, OS/computer-use environments, native notification permissions, Web Store review.

## Do Not Redo

Do not recreate repository or reintroduce editions. Do not repeat the completed single-build migration. Do not treat old acceptance results as proof that the new product is complete.

## Resume Instructions

Repository path: `/Users/apple/Developer/Projects/Chrome Extension` (old `/Users/apple/Developer/Chrome` no longer exists). Read this file and `CODEX_STATE.json`, inspect Git status and named in-progress files, then follow Next Exact Task. Use `env PATH="/opt/homebrew/bin:$PATH" npm ...` on this host (default Node 20 is too old; `/opt/homebrew/bin/node` is 24.18). Update both checkpoints at every phase/milestone and before/after long tests. Preserve and extend tests; do not skip or weaken failures.
