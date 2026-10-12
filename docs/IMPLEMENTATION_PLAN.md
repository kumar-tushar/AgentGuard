# Implementation plan

Planning baseline: empty repository; architecture, permissions, shared contracts and this acceptance matrix precede feature code.

1. Scaffold strict TypeScript, React/Vite MV3 entry points, one manifest with required debugger permission, managed schema, test/build commands and CI.
2. Implement data contracts, validation and canonical hostname matching.
3. Implement independent detector modules, bounded runtime/behavior probes, coverage handling, family-based confidence and conservative framework identification. Test each detector and scoring invariants.
4. Implement validated local/managed settings, pure policy decisions and bounded serialized audit persistence. Test malformed config, precedence, retention and domain suffix attacks.
5. Implement worker lifecycle, per-tab scan coordination, stale-result rejection, permission changes, alarms, session persistence and UI-only typed messaging.
6. Implement real emergency containment and release with optional session DNR, tab close and explicit enforcement outcomes; test partial failures and restart cleanup.
7. Implement employee popup, administrator settings/audit views and quarantined-tab UI with accessible states, uncertainty, evidence, permission controls and export.
8. Run strict type checks, unit/integration tests, the single dist/ build, real unpacked Chromium smoke tests and review the complete diff. Package one extension ZIP. Document deployment commands, manual platform checks and residual limitations.

No fake detectors, telemetry data, backend connections or hidden test skips. Any Chrome limitation stays visible in both docs and UI. Implementation discoveries update ARCHITECTURE.md and acceptance status.

The completed single-extension migration removed edition-specific builds and enables enterprise behavior through managed configuration. Preserve detector, scoring, policy, audit and UI boundaries; failed debugger access must report reduced coverage and never human/safe. See ACCEPTANCE.md for validation and environment-specific release checks.

## Employee alert follow-up (2026-10-12)

Refinement 2026-10-13: all toolbar overlays removed; stacked notifications now aggregate fresh unmuted sources onto each window's active accessible tab. Clicking switches to the existing source and focuses its window before saving its 24-hour mute. Remove the visible dismissal hint, preserve domain privacy in closed shadow content, validate host/source documents and issued tokens, expire cards independently, and test multi-window selection and per-source mute scope. Final `npm run package` passes TypeScript, 427 unit/integration tests, ten browser scenarios (47.4s), one build and one ZIP. Screenshot and archive integrity verified.

The requested red toolbar shield and unpinned top-right notice are implemented independently of the broader expansion. Acceptance was defined in ACCEPTANCE.md before feature code. Reuse generated shield assets and current assessment flow; keep presentation/mute storage separate from detection and enforcement; validate document-bound dismissal before acknowledging a 24-hour tab-only mute. Cover icon pixels, renderer serialization/expiry, storage validation/concurrency/failure, worker routing and genuine unpacked-browser click/navigation/restart behavior. Final `npm run package` passes strict TypeScript, 411 unit/integration tests, all 10 browser scenarios (44.9s), one build and one ZIP. The browser suite also passed independently (51.6s).

## Automatic-intelligence expansion

The detailed 22-phase plan is in PRODUCT_REQUIREMENTS.md; CODEX_HANDOFF.md and CODEX_STATE.json track exact continuation state. Acceptance criteria are defined before each module is implemented, and preserved tests are extended rather than suppressed.

1. Continuity and competitor/source audit: completed; parity matrix distinguishes observed source from executed behavior.
2. Six-state/identity/stack/session contracts: implemented; no human/safe or heuristic vendor claims.
3. Automatic monitoring: document-start isolated sensor, sender/document validation, startup inventory, navigation/focus/alarm batching, one debugger snapshot per batch, read-only popup. Acceptance: no UI/pinning/activeTab prerequisite; four real tabs recover after actual worker restart; missing coverage remains explicit.
4. Sessions: tab-keyed observations, bounded timeline/history, serialized crash-aware storage, local/managed retention, sanitized export/clear. Acceptance: no duplicate count inflation, coverage gaps do not end/renew previous evidence, stale tab coverage overrides sessions, unknown controller, partial-write recovery. Full browser-restart and activity integration gaps are tracked explicitly.
5. Passive debugger intelligence: implemented bounded target lifecycle/history, unknown controller, expiry and unavailable-coverage semantics, shared snapshots and coverage UI. Tab closures batch inventory refreshes; persistence failures never block newer live coverage.
6. Runtime registry: centralize existing fingerprints with typed probe/validation/attribution consumers, source/version/fixture/false-positive metadata and genuine Playwright fixture. Keep unverified legacy markers and unexecuted tools explicitly qualified; do not add AI vendor heuristics.
7. Subsequent phases: V8/environment detectors; document-bound interaction/focus correlation; stronger scoring and attribution; browser-wide popup; cross-tab alerts; delegation and one-time grants; emergency controls; Security Center; enterprise policies; security hardening; real-tool lab; 10/50/100-tab performance; release packaging.

Phase 3 validation passed typechecking, 228 unit/integration tests and six Playwright scenarios. Phase 4 passed 314 unit/integration tests and eight browser scenarios. Phase 5 passed typechecking, 347 unit/integration tests, one build and eight expanded Playwright scenarios. Earlier packaging counts are historical, not acceptance of incomplete expansion features.
