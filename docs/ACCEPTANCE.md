# Module acceptance and test plan

## Icon-only toolbar refinement (2026-10-13)

The toolbar must show only the existing green or red shield, without any badge text or symbol in any state (including warning, quarantine and unmonitored). Every update explicitly clears previous badge text. Preserve icon color transitions, qualified tooltips, popup evidence, in-page notices and policy behavior. Cover all six states, warning/quarantine, per-tab reset and real-browser removal of a previously set badge before rebuilding the single extension.

## Stacked tab notifications (2026-10-13)

- Show a vertically stacked, scroll-bounded notice for every fresh positive, unmuted tab on the active accessible HTTP(S) tab in each window, including when the extension is unpinned. No page titles, full URLs or page contents; use canonical domains and tab IDs to distinguish cards.
- Do not display the prior “Click to hide for this tab for 24 hours.” hint. Trusted click/Enter/Space switches to the existing source tab, focuses its window and mutes that source for 24 hours, as explicitly confirmed by the user. Other sources remain visible; detection and policies continue. Never open a new tab or navigate to an injected URL.
- Bind issued tokens to the notification-host document and actual source assessment/document. Reject arbitrary destination IDs, stale or missing host/source, expired evidence, synthetic events and replay. Activation/focus/save failures must not claim a saved dismissal. Remove closed/navigated/negative/disabled sources and discard old snapshots without losing other fresh cards.
- Extend existing parser, persistence, renderer and worker tests rather than removing their invariants; add multi-source stacking, cross-window activation, target-specific mutes, source/host races and real browser assertions. Keep one manifest/build and existing permissions. Restricted pages and page-controlled UI visibility remain limitations.

Verified on 2026-10-13: final `npm run package` passes strict TypeScript, **427 unit/integration tests in 20 files**, one build, **10 Playwright scenarios (47.4s)** and single-ZIP packaging. Browser coverage includes three vertically stacked cards across two windows, trusted source activation/window focus, source-specific mute, synthetic-event rejection, removed-source cleanup, navigation/restart/expiry, and clearing seeded legacy toolbar badges. Stack screenshots were visually reviewed. The separate-window fixture now creates a blank window before navigation so routing precedes HTTP; no local server is required. Earlier stack runs also passed all ten (1.1m and 57.6s). No tests skipped or removed; badge and activation expectations changed only for the requested contract. Git diff whitespace, unchanged manifest permissions and one `dist/` verified.

## Red icon and in-page alert acceptance (2026-10-12)

- All positive automation states use the red shield; suspected automation no longer displays a question-mark badge. Qualified state/tooltips remain unchanged; red never asserts verified AI identity.
- Fresh positive observations display one small top-right alert on their own accessible HTTP(S) tab, regardless of toolbar pinning or whether extension UI has been opened. No page contents, new permissions or external services are needed.
- A trusted click/keyboard activation dismisses that tab's alert for 24 hours only after successful storage acknowledgement. Detection, toolbar and policy enforcement continue. Mute survives navigation and worker restart, not tab closure/full browser-session restart; reused tab IDs must not inherit it.
- Only exact dismissal packets from the current top-frame document with an issued per-document token can mute that same tab. Reject arbitrary tab IDs, stale documents, missing/forged tokens and ordinary synthetic page clicks. Failed persistence stays visible and retryable.
- Stale/negative/unmonitored/disabled observations remove the alert. Expiry permits fresh alerts again. No duplicate overlays; other tabs remain independent. Chrome-restricted pages and hostile pages hiding/removing in-page UI remain explicit limitations.
- Validate icon pixels/state reset, parser/storage bounds/expiry/concurrency, worker routing/lifecycle, renderer freshness/accessibility and real unpinned browser click/navigation/restart/expiry behavior. Preserve all prior tests and produce one dist build/ZIP.

Verified on 2026-10-12: final `npm run package` passes strict TypeScript, **411 unit/integration tests in 20 files**, one production build, **10 Playwright scenarios (44.9s)** and `artifacts/agentguard-0.1.0.zip`. Independent browser run: ten pass (51.6s); the real compact red notice screenshot was visually reviewed. No tests were skipped, removed or weakened. Regression tests cover rechecking token expiry/invalidation after asynchronous frame lookup, failed persistence with retry, concurrent tab dismissals and ongoing monitoring while muted. Single manifest, unchanged permissions and absence of `dist-enterprise/` were verified. This acceptance covers the scoped employee-alert request, not the unfinished broader product expansion.

| # | Module | Acceptance criteria | Automated validation |
| --- | --- | --- | --- |
| 1 | Extension shell | One source tree, one MV3 manifest with required debugger permission, one dist/ build, packaged CSP-safe assets | Manifest/build checks; Chromium unpacked load |
| 2 | Service worker | Synchronous listeners; initialization gates work; errors surface; no reliance on globals for persisted state | Router/lifecycle integration; restart smoke |
| 3 | Tab monitoring | Automatic startup/event/alarm observation without popup/pinning/Scan; navigation clears old evidence, late results discarded, restricted tabs UNMONITORED | Lifecycle/generation tests; four-tab unopened browser recovery |
| 4 | Detection engine | Common interface; each failure isolated; evidence and coverage explicit | Registry error/timeout tests |
| 5 | CDP/debugger | Passive attached observation; actual access failure or uninspectable tab reports unavailable coverage; no identity claim or attach call | Detector positive/negative/unavailable cases; browser-adapter rejection/missing API/timeout cases |
| 6 | WebDriver | True signal explained; false/unknown never proves human; malformed probe rejected | Detector/validator cases; real MAIN injection |
| 7 | Fingerprints | Allowlisted existence checks only; no arbitrary globals retained; framework hints unverified | Known/unknown/forged markers tests |
| 8 | Behavior | Bounded isolated aggregate, no contents/keys/values/coordinates, self-expiring collection | Aggregate/cap/expiry tests and browser event injection |
| 9 | Scoring | Bounded finite score, correlated evidence deduplicated, weak signals stay suspected, stale evidence ignored; missing debugger coverage cannot yield a negative observation without positive evidence | Boundary/property-style scoring cases; reduced-coverage regression |
| 10 | Identification | Never name an AI vendor from generic heuristics; expose framework hints separately | Identity null for all heuristic evidence |
| 11 | Policy | Pure deterministic matching/thresholds; detection remains independent; monitor/warn/block | Policy matrix and domain attacks |
| 12 | Sensitive domains | Exact/subdomain label matching; reactive quarantine on policy match; capability gaps visible | Policy integration and containment tests |
| 13 | Audit | Domain only, serialized bounded ring, configurable retention, explicit export, no hidden upload | Concurrency/redaction/retention/export tests |
| 14 | Popup | Reads stored browser-wide and current-tab assessments only; qualified state/score/evidence/age/coverage/policy and real emergency controls | React rendering, no-scan assertions and Chromium popup |
| 15 | Settings | Validated policy editor, permission state, managed locks, audit review/export | React rendering, invalid saves and browser save smoke |
| 16 | Emergency actions | Quarantine replaces current page, optional DNR persists across worker suspension, release removes own rule, close explicit | Chrome mock integration; actual quarantine/release smoke |
| 17 | Enterprise architecture | Same artifact for all users; managed schema and runtime validation; managed overrides locked; versioned backend contract but no fake backend | Managed precedence/invalid policy/export contract tests |
| 18 | Testing | Reproducible commands, strict TS, deterministic unit/integration and real browser test; failures not suppressed | npm run check, npm run test:e2e, single build |

Platform-dependent manual release checks: real external CDP versus DevTools visibility; official Selenium/WebDriver launch; enterprise managed-policy deployment; force-installed Chrome permission policies; Chrome Web Store restrictions; permission revocation from Chrome UI; sleep/wake and supported Chrome versions. Automated headless Chromium is not a substitute for these deployment checks.

## Single-extension migration validation

This section records the prior migration baseline. For the expanded product's current status, see the later phase section and CODEX_HANDOFF.md; old states/activeTab checks below describe historical coverage, not the current product contract.

Verified on 2026-09-18 with Node 24.18.0: `npm run package` passed strict TypeScript, all **129 unit/integration tests in 12 files**, the single production build, all **5 Playwright Chromium scenarios**, and single-ZIP packaging. `npm run test:e2e` also passed independently. No tests were skipped, disabled or removed; the previous 121 unit/integration tests and four browser scenarios were retained with their expectations updated only for the new product contract. Git diff whitespace checks passed.

The real browser scenarios cover the single extension's activeTab workflow and packaged popup, settings save and warning policy, quarantine/release, same-tab escape restoration without DNR, worker termination/rehydration, storage privacy assertions, an installation-granted DNR fixture with actual blocked requests and tab isolation, automatic sensitive-domain quarantine and close, passive debugger signals, restricted-page UNKNOWN behavior, and simulated debugger API denial. The denial test retains positive WebDriver evidence and verifies that trusted activity cannot produce HUMAN when debugger access is unavailable. The pregranted fixture uses unchanged production executables and is not a distributed build. Native permission prompt consent and actual deployment policy remain the manual checks above.

Regression coverage includes rejected/forged messages, malformed probes and storage, independent detector failure/timeout, correlated evidence, expiring human-like activity, navigation/configuration races, full signed-32-bit Chrome tab IDs, serialized DNR rule allocation, containment rollback and partial failure, startup reconciliation failure, managed precedence/removal, audit retention/redaction, and UI expiry/accessibility. Migration regressions cover missing/rejected/timed-out debugger access, successful recovery and subsequent loss of access, browser-wide versus per-tab coverage, and rejection of legacy HUMAN snapshots lacking debugger coverage after a worker restart.

Packaging produces one archive: `artifacts/agentguard-0.1.0.zip`. The enterprise backend is intentionally a typed integration boundary, not a connected service. Specific AI identity remains unavailable without a verified integration.

## Migration file inventory

These 23 existing files changed in the single-extension migration; no source modules were removed or dependencies added:

- Build and manifest: `.gitignore`, `package.json`, `vite.config.ts`, `scripts/package.mjs`, `src/manifest.ts`.
- Coverage and scoring: `src/background/browser.ts`, `src/detection/debugger.ts`, `src/detection/scoring.ts`, `src/shared/contracts.ts`.
- Settings UI: `src/ui/options.tsx`.
- Tests: `tests/browser.test.ts`, `tests/detection.test.ts`, `tests/messages-settings.test.ts`, `tests/session.test.ts`, `tests/ui.test.tsx`, `tests/e2e/extension.spec.ts`.
- Documentation: `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `docs/PERMISSIONS.md`, `docs/ENTERPRISE.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/ACCEPTANCE.md`.

Removed from the repository: the generated `dist-enterprise/` directory and `artifacts/agentguard-enterprise-debugger-0.1.0.zip`. The generated `dist/` and single AgentGuard ZIP were rebuilt. Edition selection, the second build command and alternate packaging paths were removed; enterprise configuration and the detector/policy/audit/UI module boundaries were preserved.

## Automatic monitoring and sessions

Phase 3, 2026-09-19: TypeScript, 228 unit/integration tests in 15 files, single build and all six real-browser scenarios passed. The original five scenarios retain policy/containment/privacy/debugger checks; manual-scan triggers were replaced by waiting for real background observations. The sixth verifies four tabs without opening any extension UI, unpinned state and fresh observations after worker-context restart. Chromium can reuse its target/Worker object; a cleared test-only global sentinel proves the actual context reset.

Phase 4 passes TypeScript, 314 unit/integration tests in 16 files (including 81 session-engine and 45 UI cases), the single build and all eight Playwright scenarios (34.4s), including a genuine browser-process restart with the same profile. Seven browser scenarios also passed before durable restart recovery was added. No tests were skipped or removed. The product expansion as a whole is not yet release-ready.

| Module | Acceptance invariant | Tests |
| --- | --- | --- |
| Sensor boundary | Exact bounded packet, own extension, current active top-frame document, timestamp/sequence/rate limits; no targets/keys/values read | sensor.test.ts; worker.test.ts |
| Shared debugger capture | Single privacy-filtered snapshot serves 100 tabs; unavailable/error cached; no attach or owner claims | browser.test.ts |
| Session state | Deduplication, bounded counts/timeline/history, original TTL on missing coverage, serialized partial-write recovery | agent-sessions.test.ts |
| Observation mapping | Static evidence IDs, separate framework/transport, unknown controller, no arbitrary strings/URLs, no fabricated activity | session-observation.test.ts |
| Session controls | History and sanitized export are UI-only; clearing history preserves current sessions; closed tabs end | worker.test.ts; ui.test.tsx; browser scenario in progress |
| Managed retention | Legacy preferences get defaults; invalid bounds rejected; managed values cannot be overwritten | config-policy.test.ts; messages-settings.test.ts |

Pending: activity/focus wiring, V8/environment evidence, ACTIVE/CONNECTED correlation, cross-tab notifications, delegation enforcement, real-tool matrix and final performance/release packaging. These are not claimed complete by the passing implemented-module tests.

## Phase 5 acceptance before implementation

Passive debugger intelligence must track bounded target identity/type/tab ID, canonical domain when known, first/last observations, sampled attached/detached transitions and disappearance. An API failure must mark coverage unavailable, never fabricate detachment or disappearance. Out-of-order or duplicate snapshots must not renew or overwrite observations. Restored records must reject arbitrary strings/full URLs and malformed nested timelines. A sampled attachment span is not the exact connection duration, does not identify its owner and must not raise the automation score merely through repeated sampling. Tracking consumes the existing shared snapshot only: no new per-tab target calls, debugger attach or CDP commands. Tests will cover lifecycle, failure/recovery, ordering, retention bounds, privacy and worker restart.

Phase 5 verified on 2026-09-26: TypeScript, all 347 unit/integration tests in 17 files, one production build and all eight Playwright scenarios pass (49.3s). Browser assertions cover history in the actual coverage UI, unknown controller, closed-target disappearance and denied access without fabricated detachment. New failure-order regression first reproduced a live-coverage bug after consecutive rejected storage writes; the fix lets newer observations supersede failed writes. No tests were removed, skipped or weakened.

## Phase 6 acceptance before implementation

Centralize runtime fingerprints in a versioned, packaged allowlist shared by the MAIN probe, validation, evidence descriptions/weights and framework attribution. Each definition must include its ID, framework, maintainer (not observed controller), existence-only signal, reliability, tested/version limits, fixture, false-positive notes and nullable last-verified date. Distinguish source verification and actual browser fixtures from unverified legacy markers; never invent supported versions or product identity. No remote registry updates, arbitrary property enumeration, global value reads or dependency additions.

Preserve correlated-family scoring and the four existing evidence IDs. Test every allowlisted property with a throwing getter, inherited/lookalike markers, unknown/malformed WebDriver values, absent/throwing WebDriver, hostile/malformed output and serialized probe arguments. Add an actual Playwright binding fixture with automatic detection and unknown AI identity. Browser tooling that has no validated unique marker stays unattributed; Selenium/Puppeteer and other real-tool deployment tests must remain explicitly pending until executed.

Registry foundation verified on 2026-09-26: final `npm run package` passes TypeScript, all **367 unit/integration tests in 17 files**, one build, all **nine Playwright scenarios (47.1s)** and one ZIP. Browser tests also passed independently (46.2s). An intermediate packaging run reproduced an evaluation during intentional worker restart; only that exact transient error is now retried, never treated as a successful restart. The cleared global sentinel, fresh assessments/badges, preserved session IDs and unopened/unpinned UI assertions remain intact. The focused restart test passed three consecutive repetitions (18.8s). No skips, disabled assertions, timeout increases or dependency additions. Diff whitespace and single-manifest/output permissions checks pass.

The registry adds the source-checked Playwright controller-property alias without changing existing evidence weights or IDs. Failed marker inspection is now independently unavailable while readable WebDriver evidence survives; incomplete negative runtime coverage stays UNMONITORED, including restored snapshots. The broader Phase 6 research/tool matrix remains incomplete; details and source references are in RUNTIME_FINGERPRINTS.md.
