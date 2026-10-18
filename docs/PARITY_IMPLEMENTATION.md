# AgentGuard parity implementation

Request: implement missing capabilities identified by the 2026-10-15 comparison. Preserve one source tree, one manifest, one dist and one ZIP. Existing Orbit branding changes are retained. This is a staged implementation checklist, not a claim of completed parity.

## Boundaries decided before feature code

All controller identity remains unverified without authenticated evidence. New collection must not read keys, values, selectors, page text, credentials, cookies or headers. Persist canonical hostnames and fixed labels only. No source is copied from the competitor. Page hooks are best effort; browser network controls are explicitly tab-wide. No sole-agent/hostname fallback may cancel a download. Optional outbound services stay off until explicitly configured and enabled. Enterprise configuration continues to override user choices.

| Module / files | Acceptance and regression tests | Status |
| --- | --- | --- |
| Lifecycle (`background/worker`, monitor/browser tests) | Navigation invalidation cannot delete a newer scan; missing current observations retry automatically; startup/restart inventories succeed with no UI scan side effects | Implemented; failure-first regression and real restart inventory pass |
| Activity (`background/activity`, sensor/worker tests) | Accepted document-bound batches count once; replay/stale document/disabled collection never counts; navigation clears pending data; unknown initiator remains unknown | Implemented; real password-field fixture verifies counts without values |
| Reports/statistics (`session/reports`, React sessions/report tests) | Stable session IDs; bounded domain-only summaries, actual durations and coverage warnings; explicit JSON export; no misleading inactivity/identity claims | Implemented; comprehensive boundary-violation telemetry remains incomplete and explicitly qualified |
| Emergency (`background/emergency`, popup, manifest commands) | Explicit multi-tab stop confirmation; persisted latch; actual per-tab outcomes and failures; retry/reset/restart; shortcut has no new API permission; no external-process termination claim | Implemented; cleanup/write failures do not prevent attempts on remaining tabs |
| Delegation (`delegation/`, worker, React controls) | Presets, sites, expiry, per-tab overrides, revoke; effective scope validated; managed denial wins; enforcement-strength labels; restart/expiry tests | Implemented best-effort page boundaries and optional tab-wide DNR, not native-driver sandboxing |
| Pauses/one-time grants (`delegation/`) | Document/scope-bound single-use exceptions; TTL; no replay across navigation or kill; pause keeps detection active; managed policy cannot be bypassed | Implemented; real single-use/pause/resume test passes; no DNR bypass |
| Browser network enforcement (`background/egress`) | Optional per-tab DNR; no hidden debugger attach; cleanup; HTTP(S)/WebSocket limits tested | Implemented; separate ID range, deny precedence, scoped host limits |
| Network/download observations (`background/traffic`) | Explicit CDP lease; bounded hostname-only records; no sole-active-session attribution; actual cancellation confirmation | Implemented; downloads deliberately remain tab/initiator unknown, only explicit browser-wide cancellation supported |
| Additional signals (`detection/`, MAIN probe) | Fixed bounded hints, false-positive controls, family scoring, no vendor certainty, real-tool fixtures; incompatible probes reduce coverage | Optional selected-API stack hints implemented; real Playwright passes, Puppeteer synthetic only; weak environment patterns and broader real-tool matrix deferred |
| Notifications (`background/notifications`) | Optional permission, source-specific activation, no full URL, duplicate suppression, no policy changes from dismissal | Implemented; OS/native consent and delivery remain manual release checks |
| Optional services (`integrations/`) | Opt-in, HTTPS, bounded responses/timeouts, no credentials/redirects/page data; type trust is not verified controller identity; consented aggregate-only contribution | Implemented clients and manual UI; no configured/deployed server or live provider compatibility claim; see INTEGRATIONS.md |
| Updates (`background/updates`) | Pending version, idle application, explicit confirmation before active-control reload; failed state load defers application | Implemented; serialized staging/application tests |
| Docs/build/enterprise schema | Permission rationale, security approval, schema/default migration, architecture and handoff updates; all existing tests retained, expanded unit/integration and real Playwright tests; one production build | All SECURITY changes approved/applied; final serial package passes TypeScript, 465 unit/integration tests, 16 browser scenarios and byte-matched ZIP |

## Permission design

Keep required `storage`, `scripting`, `alarms`, `debugger`, `webNavigation` and HTTP(S) access. Optional DNR, downloads and notifications are requested only through explicit UI gestures. `commands` is a manifest key, not a permission. Never request cookies, history or webRequest for parity. Remote backend deployment requires a real organization endpoint and authentication decisions; neither inspected extension ships that service. Keep this separate from local feature parity and report it explicitly.

## Deliberate non-claims

Do not reproduce the competitor's title/URL vendor attribution, generic callFunction→Selenium inference, Linux/software-rendering→named AI identity, sole-agent download attribution or repeated-session inflation. Page hooks remain bypassable and can affect page compatibility. Activity remains tab-level, not an authenticated agent action feed. Session reports do not claim complete boundary/network histories. Organization fleet ingestion/enrollment/authentication, complete environment/native-controller coverage, real Selenium/Puppeteer/OS-tool validation and Web Store/managed-policy acceptance remain separate work, not fake implementations.

## Validation order

Add a failing regression before fixing observed lifecycle races. Typecheck and run focused tests after each module, then the complete unit/integration suite. Build before browser tests and do not rebuild concurrently with them. Run browser checks serially, preserve failure evidence and never weaken assertions or inflate timeouts to obtain green results. Document exact delivered and unfinished modules at every checkpoint.
