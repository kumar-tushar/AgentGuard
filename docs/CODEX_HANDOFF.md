# AgentGuard Codex Handoff

## Current checkpoint — 2026-10-18: behavioral false positives (takes precedence below)

User explicitly requested removing behavioral false-positive detection everywhere. This scoped fix is complete. Regular scrolls/page-script clicks no longer produce the former 0.18/0.16 suspicion or inflate real scores. Behavior is activity-only; legacy/crafted behavioral indicators are excluded from scoring, new behavioral-only positive session observations and restored tab labels/policies are rejected, and worker-restored behavioral-only active sessions are retired. History/audit and quarantine records are retained, not silently deleted/released. Real runtime/debugger signals, coverage warnings, one build, Orbit Pointer branding, 400px popup and all earlier dirty work remain intact.

Acceptance/test plan is in docs/ACCEPTANCE.md. Implemented activity-only behavior detector, a shared control-evidence/deadline rule, scorer/engine/restoration guards, live session rejection and retirement of behavioral-only worker-recovered sessions. Retired fixed IDs remain parseable only for historical compatibility. Full-browser restarts retain browser_restart archival semantics. Activity expiry is independent of assessment/session expiry in monitor, mapper and UI. Settings/managed schema explain Activity context; behaviorEnabled remains compatible. README/architecture updated. The exact SECURITY.md bullet was explicitly approved, reread and applied; resolver confirms root SECURITY.md is the sole applicable source policy, with no exclusions or severity changes.

Thirteen failing-first regressions reproduced the old behavior. Final serial `npm run package` passes strict TypeScript, **492 unit/integration tests in 31 files**, one build, **all 21 Playwright scenarios (1.8m)** and one ZIP. Sixteen unit/integration cases and one browser scenario were added; prior behavioral-suspicion/expiry assertions were updated for the requested contract, with no tests skipped/removed or unrelated assertions weakened. The browser scenario exercises actual collected scrolls/script clicks while isolating the harness's CDP/WebDriver signals, no current/cross-tab notice/session/policy/quarantine, green 0/100 popup and restored real Chromium WebDriver evidence at 0.82. An initial browser harness failure came from invalidating on every poll before the 200ms observation batch; it now navigates once and waits for the stored assessment, without relaxed assertions/timeouts. This is not a substitute for normal-headed/manual deployment validation.

New file: src/detection/evidence.ts. Modified source for this scope: detection behavior/engine/scoring; background monitor/session/session-observation/agent-sessions; shared contracts; UI components/freshness/options; public managed schema. Tests: detection/monitor/session/session-observation/agent-sessions/worker/UI and the browser suite. Docs: README.md, ARCHITECTURE.md, approved SECURITY.md, ACCEPTANCE.md, IMPLEMENTATION_PLAN.md and continuation files. No permissions, dependencies or source files removed; unrelated uncommitted work preserved.

Normal-activity popup screenshot and scoped diff reviewed; native 400px popup regression still passes. ZIP integrity passes; all **23 files** byte-match dist, all eight icon bytes match their generator and the packaged manifest matches source with unchanged permissions. SHA-256: `7a4d33455814322ae35013320b628822d417f0508051475f2d6bc94048828ecb`. Artifact: artifacts/agentguard-0.1.0.zip; unpacked build: dist/. Reload the extension to apply; existing quarantines still need explicit release. No commits, pushes or live Chrome-profile changes. Next product work remains the broader boundary telemetry/stronger attribution and deployment matrix below; this fix does not complete that roadmap.

## Previous checkpoint — 2026-10-18: Orbit Pointer branding

User selected concept 3, Orbit Pointer. The existing deterministic icon generator now renders the open circular orbit/inset cursor in green and red, with transparent cutouts and restrained shading. Existing asset paths propagate it to the manifest/toolbar, shared popup/settings/containment headers, favicons and optional desktop notifications. No detection, policy, consent, permission, dependency or native popup-width change. SECURITY.md is unchanged for this branding-only request; all prior dirty-worktree work is preserved.

Modified for this scope: scripts/icons.ts, tests/icons.test.ts, tests/e2e/extension.spec.ts, README.md, ARCHITECTURE.md, docs/ACCEPTANCE.md and both continuation files. Old-logo-specific pixel expectations now cover the selected shape; all state/behavior/layout tests remain. Final serial `npm run package` passes strict TypeScript, **476 unit/integration tests in 31 files**, one production build, **all 20 Playwright scenarios (1.7m)** and one ZIP. One browser scenario was added to decode all eight actual packaged assets and verify alpha, dimensions, cutouts and colored geometry. Native-size dark/light previews and actual settings/containment/native-popup screenshots were visually reviewed. Native first-open/reopen width remains 400px. No tests skipped or removed, no behavioral assertions weakened.

ZIP integrity passes and all 22 files byte-match dist; all eight icon bytes also match the source generator. SHA-256: `dafbbfef309fdccc08269763270c0d17fd12fdd9f15ec308f6075dfc21e2a9fc`. Artifact: `artifacts/agentguard-0.1.0.zip`; unpacked build: `dist/`. Scoped logo selection is complete. Reload the unpacked extension and reopen its popup to apply. This is not completion of the broader product roadmap below; its next work remains boundary telemetry/stronger attribution and deployment validation. No commits/pushes or live Chrome-profile changes.

## Previous checkpoint — 2026-10-18: native popup width

The reported narrow toolbar popup is fixed. Production changes are limited to `popup.html` (popup-only body class) and three sizing declarations/comments in shared CSS: explicit document width/minimum width 400px, shell width 100%, no viewport-dependent maximum. Settings and containment remain responsive; no detection, policy, permission, dependency or security-guidance changes. Earlier dirty-worktree work remains intact. No commits, pushes or live Chrome-profile changes.

A failure-first test opened Chrome's actual action popup and reproduced a 206px viewport against the required 400px; earlier ordinary-tab screenshots with a forced viewport had missed native auto-sizing. The native regression now opens/reopens through `chrome.action.openPopup()`, inspects distinct native CDP targets without viewport emulation, checks width/header/no horizontal overflow, waits for native geometry/frames, and verifies bounded height plus real scrolling to the footer. Teardown confirms the old target is gone before reopening. Existing ordinary-tab/layout and behavioral tests remain unchanged. The native first-open screenshot was visually reviewed.

Final production `npm run package` passed strict TypeScript, **476 unit/integration tests in 31 files**, one build, **all 19 Playwright scenarios (1.5m)** and one ZIP. A subsequent test-only teardown strengthening passed typecheck and the native regression again (8.2s); production bytes were unchanged. ZIP integrity passes and all 22 files byte-match dist. SHA-256: `e0c02b67e156c567211e1083a6f0b670fdabdc3df25b01e2d2e43b45aae39ac0`. No tests skipped, removed or weakened. Reload the unpacked extension and reopen the popup to apply. Broader roadmap/deployment limitations below remain in force.

## Previous checkpoint — 2026-10-18: dark UI

Latest scoped request is complete: modern dark UI across popup, all settings sections, sessions/reports, containment and in-page notices. Shared CSS tokens standardize charcoal surfaces, mint actions, amber uncertainty, red risk, text hierarchy, spacing and alignment. The popup leads with the current assessment and tab controls rather than browser totals; it no longer repeats the headline as a status chip. Decorative typed inline SVGs improve navigation without new dependencies or accessible-name changes. Settings forms stack at narrow widths and tables scroll locally without compressing columns. Existing Orbit assets, evidence/identity qualifications, consent, confirmations, policy and release-return behavior are preserved. No new permissions, collection or remote assets; SECURITY.md was not changed for this visual-only request. All earlier dirty-worktree work is preserved; no commits, pushes or live Chrome-profile changes.

Final serial `npm run package` passes TypeScript, **476 unit/integration tests in 31 files**, one dist build, **all 18 Playwright scenarios (1.4m)** and one ZIP. All 22 archived files byte-match dist; integrity passes. SHA-256: `62ed63d55eba6aba112702bc9d09af23088a8f563a1d2bfefd39eb6fbd46500d`. One unit case and one browser scenario were added; notice styling assertions were expanded and no prior test removed or weakened. Browser checks cover all eight settings sections at 1440/800/390 pixels, a 400×600 popup with answer/actions together, viewport containment, actual local table scrolling, keyboard focus, reduced motion and token contrast ≥4.5:1. Overview, policy, popup, containment and stacked-notice screenshots were inspected in disposable profiles. An earlier 605-pixel popup overflow was corrected by removing duplicate status copy; the viewport assertion was retained. This is not a complete manual accessibility/deployment certification. Broader roadmap items remain below.

## Previous checkpoint — 2026-10-17

Latest scoped request is complete: product wording now uses User/user instead of the prior term, including display conversion of saved quarantine reasons. The internal `employeeControlsAllowed` key remains for existing organization policy/settings compatibility. Release now removes containment and persists its removal before requesting return to the previous real page using script history navigation inside the packaged containment page. The worker authenticates and targets that page with a private nonce/tab command; no original URL/history entry contents are read or stored, no permission added and no policy bypass created. Cleanup-only release does not navigate. The already-released screen offers Return to previous page; unavailable history/navigation explains failure and permits retry. Detection and policy may quarantine the returned page again. Unsaved state is not guaranteed to survive.

Implementation touches the existing recovery/containment/worker contract, popup and blocked UI, adds `src/ui/page-return.ts` with authenticated command tests, and updates relevant terminology/docs/tests. Approved exact SECURITY.md changes were reread/applied, then re-resolved: root SECURITY.md is the sole policy for the changed source. No exclusions or severity changes. Existing uncommitted expansion/Orbit work is preserved; no dependencies, commits, pushes or live Chrome-profile changes.

Final serial `npm run package` passed strict TypeScript, **475 unit/integration tests in 31 files**, one build, **all 17 Playwright scenarios (1.5m)** and one ZIP. The three focused release/DNR/restart browser scenarios also passed (19.9s). Earlier real-browser failures exposed browser-style Back skipping unactivated entries and the Navigation API hiding cross-origin entries; fixes use one-step script history.back, not relaxed assertions or timeouts. Existing tests remain; ten unit cases and one browser scenario were added, with prior release expectations updated for the requested behavior. ZIP integrity passed and all 22 files byte-match dist. SHA-256: `b8debc9484bc3f7b93ceb9ca93519cc80f55d3a3ac9a2e25a7552b7856b1247d`. No full-product certification is implied. Broader remaining work below is unchanged.

## Previous checkpoint — 2026-10-16

Latest user request: continue implementing the missing competitor features, preserving one extension. Local feature expansion is implemented in modular files: activity batches, session reports/statistics, emergency latch/shortcut/outcomes, delegation/scopes/expiry/pauses/Allow Once, tab-wide DNR egress, explicit CDP traffic leases, conservative browser-wide downloads, optional desktop alerts, selected-API stack hints, manual bounded HTTPS service clients and staged updates. Existing Orbit branding and all earlier uncommitted user work are preserved. No dependencies, commits, pushes or live Chrome-profile changes.

Final serial `npm run package` passed strict TypeScript, 465 unit/integration tests across 30 files, one build, all 16 Playwright scenarios (1.2m) and the single ZIP. ZIP integrity passes; all 22 archived files match current dist bytes. SHA-256: `87178249a23ea4e05d5398bb551e7aaacf8b633ac28d106ee6aa0f50b177ddf4`. Earlier overlapping runs were interrupted and are not the final validation evidence. A pre-existing UI test now awaits the same expected loaded data instead of racing the static header; no assertions were removed, skipped or weakened.

SECURITY.md extended-controls/optional-service edits and the additional exact site-declaration paragraph were explicitly approved and applied. Root SECURITY.md was re-resolved as the sole applicable policy for src. No review exclusion, severity suppression or certification claim was added.

Next product work: comprehensive boundary-violation telemetry/stronger activity attribution, weak environment research without vendor certainty, real Selenium/Puppeteer/normal-headed/OS tooling matrix, native notification/managed policy/provider deployment validation and a separately designed authenticated organization backend. Do not claim these are implemented or copy the competitor's unsafe attribution heuristics. Optional external services are disabled with no endpoints by default; no live server compatibility or backend deployment is implied. See PARITY_IMPLEMENTATION.md, PARITY_DELIVERY_2026-10-16.md and INTEGRATIONS.md. All earlier Orbit/user changes remain uncommitted and preserved.

Everything below is historical context, not current remaining work or final test results.

## Overall Objective

Evolve the existing single AgentGuard extension into automatic browser-wide, privacy-safe automation intelligence with recoverable sessions, conservative attribution, cross-tab alerts, real delegation/containment controls and enterprise configuration. Full user specification: [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md).

## Current Phase

Phase 6 — WebDriver/runtime fingerprint registry (in progress). Phases 0–5 implemented and validated; sensor activity/correlation is deliberately deferred to the later detector phases.

## Latest Refinement (2026-10-13)

User requested icon-only green/red toolbar (no badges), removal of the visible 24-hour hint, vertically stacked notifications for multiple automated tabs, and confirmed that clicking must switch to the source tab and mute it for 24 hours. Implemented in existing browser/worker/tab-alert modules; no permissions, dependencies or extra builds added. Active accessible HTTP(S) tabs in each window receive the shared source stack; per-host/source document tokens cannot select arbitrary destinations. No source domains are placed in page-readable attributes. Mutes remain source-tab keyed across all hosts and do not disable detection or policy. Prior source-tab-only alert tests were extended to real cross-tab/cross-window activation while retaining old privacy, persistence, expiry, rejection, restart and policy checks.

Final `npm run package` passes strict TypeScript, 427 unit/integration tests in 20 files, one build, all ten Playwright scenarios (47.4s) and the single ZIP. Earlier stack runs also passed all ten (1.1m and 57.6s); icon-only interim suite passed ten (49.4s). Inactive stack clears use ordered empty snapshots, and the separate-window fixture routes before HTTP navigation to avoid a machine-local server dependency. Final stack screenshot was visually reviewed; ZIP integrity and diff whitespace verified. The updated security paragraph was explicitly approved; root SECURITY.md is the sole applicable policy. This latest scoped refinement is complete. Old results below are historical, not the latest artifact state.

## User Alert Request (2026-10-12)

The latest user request is to finish the red detection icon, a compact top-right in-page notice that works when unpinned, a 24-hour per-tab dismissal, and make the final build. Implementation and packaging are complete. Final `npm run package` passes strict TypeScript, 411 unit/integration tests in 20 files, the single build, all 10 Playwright scenarios (44.9s) and `artifacts/agentguard-0.1.0.zip`. All ten browser scenarios also passed independently (51.6s). The new screenshot was visually verified; no tests were skipped, removed or weakened. This completes the scoped user-alert feature, not the broader 22-phase specification.

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

Latest user-alert follow-up, 2026-10-12: `env PATH="/opt/homebrew/bin:$PATH" npm run package` — PASS: strict TypeScript; 411 unit/integration tests in 20 files; one dist build; ten Playwright scenarios (44.9s); single ZIP. Independent browser suite: ten pass (51.6s). `git diff --check` passes. Manifest permissions unchanged, no second build, no skipped/disabled/removed tests. All earlier results below are historical.

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
