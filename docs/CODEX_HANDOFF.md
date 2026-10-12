# AgentGuard Codex Handoff

## Overall Objective

Evolve the existing single AgentGuard extension into automatic browser-wide, privacy-safe automation intelligence with recoverable sessions, conservative attribution, cross-tab alerts, real delegation/containment controls and enterprise configuration. Full user specification: [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md).

## Current Phase

Phase 6 — WebDriver/runtime fingerprint registry (in progress). Phases 0–5 implemented and validated; sensor activity/correlation is deliberately deferred to the later detector phases.

## Latest Refinement (2026-10-13)

User requested icon-only green/red toolbar (no badges), removal of the visible 24-hour hint, vertically stacked notifications for multiple automated tabs, and confirmed that clicking must switch to the source tab and mute it for 24 hours. Implemented in existing browser/worker/tab-alert modules; no permissions, dependencies or extra builds added. Active accessible HTTP(S) tabs in each window receive the shared source stack; per-host/source document tokens cannot select arbitrary destinations. No source domains are placed in page-readable attributes. Mutes remain source-tab keyed across all hosts and do not disable detection or policy. Prior source-tab-only alert tests were extended to real cross-tab/cross-window activation while retaining old privacy, persistence, expiry, rejection, restart and policy checks.

Final `npm run package` passes strict TypeScript, 427 unit/integration tests in 20 files, one build, all ten Playwright scenarios (47.4s) and the single ZIP. Earlier stack runs also passed all ten (1.1m and 57.6s); icon-only interim suite passed ten (49.4s). Inactive stack clears use ordered empty snapshots, and the separate-window fixture routes before HTTP navigation to avoid a machine-local server dependency. Final stack screenshot was visually reviewed; ZIP integrity and diff whitespace verified. The updated security paragraph was explicitly approved; root SECURITY.md is the sole applicable policy. This latest scoped refinement is complete. Old results below are historical, not the latest artifact state.

## Employee Alert Request (2026-10-12)

The latest user request is to finish the red detection icon, a compact top-right in-page notice that works when unpinned, a 24-hour per-tab dismissal, and make the final build. Implementation and packaging are complete. Final `npm run package` passes strict TypeScript, 411 unit/integration tests in 20 files, the single build, all 10 Playwright scenarios (44.9s) and `artifacts/agentguard-0.1.0.zip`. All ten browser scenarios also passed independently (51.6s). The new screenshot was visually verified; no tests were skipped, removed or weakened. This completes the scoped employee-alert feature, not the broader 22-phase specification.

Changes for this request only:

- Added `src/background/tab-alerts.ts`, `src/content/tab-alert.ts`, `tests/tab-alerts.test.ts`, `tests/tab-alert.test.ts`, `tests/icons.test.ts`.
- Updated `scripts/icons.ts`, `vite.config.ts`, `src/background/browser.ts`, `src/background/worker.ts`, `tests/browser.test.ts`, `tests/worker.test.ts`, `tests/e2e/extension.spec.ts`.
- Updated `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `docs/ACCEPTANCE.md`, `docs/IMPLEMENTATION_PLAN.md` and both continuation files. The SECURITY.md addition was previewed and explicitly approved, then the root-only policy chain was rechecked.
- Removed no source files; added no dependencies or permissions. All pre-existing fingerprint/debugger work remains intact. One manifest, `dist/` and ZIP remain.

Positive automation states select the red shield; suspected automation no longer uses `?`. Alert dismissal never changes detection, audit or policy. Session-stored mute deadlines survive worker restart and same-tab navigation but not close/replacement/full browser restart. Restricted pages may not show notices, hostile pages may obscure them, and automation can generate trusted clicks. The notice always keeps identity unverified and confidence qualified.

## Completed

- Existing single-source, single-manifest, single-dist, single-ZIP architecture preserved.
- Prior migration validated 129 unit/integration tests and five real Chromium scenarios; these are the baseline, not completion of the new request.
- Read the full new specification and stored it in this repository.
- Created both mandatory continuation files before substantive implementation.
- Added `src/shared/intelligence.ts`: six truthful control states, separate identity/stack/session/activity/delegation/provider contracts and conservative activity attribution helpers.
- Five new contract tests pass, including unrelated Tab 4 download while only Tab 1 has automation: UNKNOWN attribution, never agent-specific enforcement.
- Audited event-driven monitoring migration and official Chrome content-script/debugger/navigation/notification/command APIs. Competitor source pinned to a4ca981c65254b9e95bfbca2411881720a5c9e81 (0.7.0); reject URL/title-based identity and fallback download attribution.

## In Progress

Phase 5 is complete. Phase 6 registry consumers and genuine Playwright exposeBinding fixture are implemented and validated. Final `npm run package` passes TypeScript, 367 unit/integration tests, one build, nine browser scenarios (47.1s) and one ZIP. The browser suite also passed independently (46.2s). An intermediate packaging run hit an evaluation racing the intentional worker restart; the harness now retries only that exact transient error, retaining every restart/freshness/session assertion. The focused restart scenario passed three repetitions (18.8s) before final packaging. User-approved SECURITY.md updates were applied and the security-policy chain rechecked. No SCAN_TAB API exists.

## Next Exact Task

Icon-only toolbar and stacked cross-tab notifications are complete and packaged. Do not recreate their modules. The broader deferred task remains:

Continue Phase 6 primary-source research and actual Selenium/Puppeteer/normal headed Chrome validation. Registry version 1, its consumers and real Playwright binding fixture are done; do not rebuild them. Three legacy entries explicitly lack verified provenance/version ranges. See RUNTIME_FINGERPRINTS.md. Research browser-use/Stagehand/agent-browser and named AI tooling without inventing unique markers; then proceed to the separate V8 stack detector phase.

## Files Changed

Current continuation (relative to baseline ad67706):

- Added: `src/shared/fingerprints.ts`, `docs/RUNTIME_FINGERPRINTS.md`.
- Modified runtime/background: `src/background/browser.ts`, `src/background/debugger-intelligence.ts`, `src/background/session-observation.ts`, `src/background/worker.ts`, `src/content/runtime.ts`, `src/shared/contracts.ts`.
- Modified detectors: `src/detection/fingerprint.ts`, `src/detection/identity.ts`, `src/detection/scoring.ts`, `src/detection/validation.ts`.
- Extended tests: `tests/debugger-intelligence.test.ts`, `tests/detection.test.ts`, `tests/e2e/extension.spec.ts`, `tests/probes.test.ts`, `tests/session.test.ts`, `tests/worker.test.ts`.
- Updated documentation: `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `docs/ACCEPTANCE.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/CODEX_HANDOFF.md`, `docs/CODEX_STATE.json`.
- Removed: none. No dependency, manifest or build-script changes; one `dist/` and one ZIP remain. Generated output is rebuilt, not a second edition.

## Architecture Decisions

- Reuse detection/policy/audit/background/React UI modules; never replace the repository.
- One build and artifact for every deployment; managed policy overrides local settings.
- New target states replace human claims, but perform contract migration in tested increments.
- Automatic monitoring requires declared HTTP(S) host access; activeTab is not a monitoring prerequisite. Permission changes follow official API research and consumers.
- No page content/credentials, no hidden uploads, no debugger attach for detection; controller identity remains unknown absent independently trusted evidence.
- Git now has baseline commit ad67706 (observed on 2026-09-26). Earlier unborn-HEAD notes are historical. Preserve the committed baseline and current working changes; do not reset, commit unrelated files or force-push.

## Tests Last Run

Latest stacked-notification refinement, 2026-10-13: `env PATH="/opt/homebrew/bin:$PATH" npm run package` — PASS: strict TypeScript; 427 unit/integration tests in 20 files; one dist build; ten Playwright scenarios (47.4s); single ZIP. Screenshot and ZIP integrity verified, `git diff --check` passes, no new dependencies or permissions. All earlier entries below are historical.

Latest employee-alert follow-up, 2026-10-12: `env PATH="/opt/homebrew/bin:$PATH" npm run package` — PASS: strict TypeScript; 411 unit/integration tests in 20 files; one dist build; ten Playwright scenarios (44.9s); single ZIP. Independent browser suite: ten pass (51.6s). `git diff --check` passes. Manifest permissions unchanged, no second build, no skipped/disabled/removed tests. All earlier results below are historical.

Current continuation, 2026-09-26: `env PATH="/opt/homebrew/bin:$PATH" npm run package` — PASS: TypeScript; 367 unit/integration tests in 17 files; one dist build; nine Playwright scenarios (47.1s); `artifacts/agentguard-0.1.0.zip`. Independent browser suite: nine pass (46.2s). Intentional worker-restart scenario: three repetitions pass (18.8s) after its narrow transient-error retry. `git diff --check` passes. Manifest permissions and absence of dist-enterprise verified. The following entries are historical milestones.

Previous completed single-build migration, 2026-09-18:

`npm run package` — PASS (TypeScript; 129 unit/integration tests across 12 files; one build; five Playwright scenarios; one ZIP).

`npm run test:e2e` — PASS (five tests independently).

`git diff --check` — PASS.

Phase 2 additive contracts: `env PATH="/opt/homebrew/bin:$PATH" npm run typecheck` — PASS; `env PATH="/opt/homebrew/bin:$PATH" npm test` — 134 passed, 0 failed in 13 files. Build/e2e/package not rerun for new phase yet.

Phase 3 `npm run check` — PASS (TypeScript; 228 unit/integration tests, 15 files; one dist build). Playwright: all six pass (23.1s). Sixth test originally waited for a new Worker object; Chromium reused the target after real context restart. Test now verifies a cleared global sentinel plus all four fresh observations/badges, no UI opened and unpinned state. No timeout increase or removed assertions.

Phase 4 `npm run check` — PASS (TypeScript; 296 unit/integration tests, 16 files; one dist build). Seven expanded browser scenarios are ready but not yet validated against this build.

Final Phase 4 verification: TypeScript, 314 unit/integration tests (16 files), single build, and all eight Playwright scenarios PASS (34.4s), including actual full-browser restart using the same profile. Session store has 81 tests; UI 45. Prior seven-scenario build also passed before adding browser-restart coverage.

## Known Failures

Phase 5 final verification on 2026-09-26: `npm run check` passed (347 tests, 17 files); `npm run test:e2e` passed all eight scenarios (49.3s). One newly added regression failed before its implementation fix and passed afterward. No known failures in the completed phase.

No outstanding reproduced failures after final validation. Two new regression tests first demonstrated real coverage bugs (rejected history writes blocking later observations; failed fingerprints allowing negative coverage) and pass with their fixes. Durable session history contains up to configured-count active recovery copies plus configured-count ended records (default50+50, max500+500); zero disables both durable sets. Losing the session journal after a rejected durable end/clear can only recover the last successful durable snapshot; this limit is tested/documented. Stacked cross-tab notifications are implemented. Broader runtime provenance/tool validation, sensor activity/correlation, stack/environment sensors, delegation, complete Security Center and real-tool matrix remain pending. This development ZIP is not acceptance of the whole product; do not claim release readiness.

## Manual Tests Required

Real managed Chrome policy, normal headed Chrome versus DevTools, actual Codex/Claude tools, unavailable Selenium/Puppeteer tools until installed/validated, OS/computer-use environments, native notification permissions, Web Store review.

## Do Not Redo

Do not recreate repository or reintroduce editions. Do not repeat the completed single-build migration. Do not treat old acceptance results as proof that the new product is complete.

## Resume Instructions

Repository path: `/Users/apple/Developer/Projects/Chrome Extension` (old `/Users/apple/Developer/Chrome` no longer exists). Read this file and `CODEX_STATE.json`, inspect Git status and named in-progress files, then follow Next Exact Task. Use `env PATH="/opt/homebrew/bin:$PATH" npm ...` on this host (default Node 20 is too old; `/opt/homebrew/bin/node` is 24.18). Update both checkpoints at every phase/milestone and before/after long tests. Preserve and extend tests; do not skip or weaken failures.
