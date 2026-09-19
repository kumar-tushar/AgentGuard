# AgentGuard architecture

## Product contract

AgentGuard reports evidence of browser automation, not proof of AI intent. No available Chrome API identifies an arbitrary external AI controller. `identifiedAgent` is null unless a future authenticated integration supplies independently verified identity. Framework hints are explicitly unverified.

Shared states are `AGENT_ACTIVE`, `AGENT_CONNECTED`, `AUTOMATION_LIKELY`, `AUTOMATION_SUSPECTED`, `NO_AUTOMATION_OBSERVED` and `UNMONITORED`. None asserts human control or safety. Current detectors emit the latter four; the session state machine supports ACTIVE→CONNECTED decay but stronger correlation that emits those states is a later phase. A positive WebDriver flag supports likely automation; ambiguous debugger/fingerprint/behavior signals support suspicion. No automation observed requires available runtime and debugger coverage with no positive signals. Coverage gaps without positive evidence yield UNMONITORED. Confidence is heuristic support, not a calibrated probability.

## Repository design (defined before feature implementation)

```
src/shared/       versioned contracts, validation, domain normalization
src/detection/    common detector interface, independent detectors, scoring, identification
src/content/      bounded MAIN probe, ISOLATED behavior collector and document-start event sensor
src/policy/       pure policy evaluation, no Chrome API dependencies
src/enterprise/   validated defaults + managed configuration precedence
src/audit/        bounded local event store and future sink interface
src/background/  Chrome adapters, tab lifecycle, orchestration, trusted message router
src/ui/          React popup, options, blocked-tab UI and shared components
public/          managed-storage schema and extension assets
tests/           unit, service-worker integration and browser extension tests
docs/            implementation plan, acceptance matrix, permissions, operations
```

The core accepts sanitized snapshots; browser calls stay in adapters. Flow: Chrome events/alarms → tab snapshot → detector registry → score and identity → policy decision → enforcement → local audit. Detector errors become coverage gaps, not clean bills of health. No future backend code runs in the extension by default. `AuditSink` and versioned exports define the backend boundary; a deployment must supply authentication, consent, transport, retention and server authorization before connecting it.

## Lifecycles and trust boundaries

Service worker listeners register synchronously. Each worker activation inventories and assesses existing tabs. Static document-start sensors, tab/window events, same-document navigation and the minute alarm trigger bounded reconciliation; the popup reads stored results only. `storage.session` preserves tab/automation-session state through worker suspension but clears on full browser restart. `storage.local` stores configuration, bounded audit and ended-session history. Navigation invalidates previous-document evidence immediately; generation/configuration guards discard late results. Tab observations run four at a time, sharing one sanitized debugger-target snapshot per batch. All inventoried tabs are processed; tab assessment retention is capped at 500 and an explicit capacity warning is shown above that. Evidence expires after at most 90 seconds, bounded by earliest supporting evidence expiry; open UI views expire independently. Restricted pages remain unmonitored. Top-frame probes cannot cover every iframe or cross-origin controller.

Behavior collection runs in an isolated world, installs once per document, keeps bounded aggregates and expires without refresh. It records counts/coarse intervals, never keys, values, coordinates, DOM contents or selectors. The separate event sensor batches bounded counters after configuration acknowledgement and stops activity collection without renewal. Its messages are strictly validated against sender extension ID, top frame, active document ID, timestamp, sequence and rate limits; Chrome's current frame is rechecked before scheduling. Sensor counts are not yet wired into session activity/correlation. MAIN-world results are hostile and rebuilt through allowlist validation. No page-to-extension `postMessage` command channel exists. Only packaged UI pages can mutate settings, export logs, quarantine or close tabs; content sensors cannot.

Scoring uses the maximum within a correlated family, then combines families with explicit caps. Runtime WebDriver and framework markers share a family. Behavioral anomalies remain weak. WebDriver ≥0.8 or independent debugger support with combined score ≥0.75 yields AUTOMATION_LIKELY. Debugger-only evidence never identifies an agent. No positive evidence has a zero support score, not a probability of human control.

## Automation sessions

`AgentSessionStore` is separate from tab assessments and audit. It serializes mutations, validates every persisted field against static labels/enums, deduplicates observations, preserves session IDs through worker restart and bounds active sessions (500) and per-session timeline (100). Ended history defaults to 50 records/seven days with local/managed limits. The durable envelope also keeps up to the same count of recent active recovery snapshots (default 50+50, hard maximum 500+500). Missing session storage at a full restart archives those snapshots as browser_restart; they never bind to a reused live tab ID. Zero history disables durable active recovery too. Old recovery records are age-filtered before archival. A session-storage transition journal retains terminal records if a cross-area history write fails; losing that journal during a full restart can only recover the last successful durable write, not a failed end/clear action. UNMONITORED is not negative evidence: prior observations keep their original TTL without renewal but cannot appear as current coverage. Dashboard sessions require a matching fresh tab assessment. History/export/clear APIs are UI-only; clear does not terminate active sessions. Controller identity remains null; framework/transport labels are separate. Activity counters remain zero until document-bound correlation is integrated.

## Policy and containment

Policies match canonical hostnames on label boundaries, not URL substrings. Mode `monitor` records; `warn` produces a warning decision/badge; `block` quarantines a matching sensitive tab once the configured risk threshold is met. This is reactive protection: a page may have acted before detection. No policy claims to be a complete DLP boundary.

Quarantine navigates the tab to a packaged extension page, destroying its current document. When the optional DNR-with-host-access permission and persistent host access are granted, a session rule also blocks HTTP(S) requests in that tab for authorized hosts. The rule explicitly enumerates resource types including `main_frame`; Chrome's default omits top-level navigation. Release removes that rule but does not automatically return to the original URL (which is not retained). Closing a tab is a separate explicit emergency action. These operations cannot terminate an external agent, detach someone else's debugger, stop browser/OS automation, undo prior requests or prevent new tabs. Quarantines and their session rules are reconciled after worker restart and tab closure; reconciliation failure surfaces a health error without disabling recovery commands. A quarantine record is distinct from the currently loaded document: navigation away triggers reactive restoration, and the monitor observes escaped pages until replacement succeeds. Restoration cannot guarantee that the destination has not already acted. Enforcement failure is visible and audited.

## Single build and permissions

One source tree and one manifest produce one `dist/` extension for individual and enterprise-managed users. Required APIs: `storage`, `scripting`, `alarms`, `debugger`, `webNavigation`; required hosts: HTTP(S). Only `declarativeNetRequestWithHostAccess` is optional. There is no activeTab or manual-scan prerequisite. Chrome forbids optional debugger permission. Managed configuration changes behavior, not artifacts. No `tabs`, `cookies`, `webRequest`, `history`, `management`, remote code, analytics, or network upload is added. See [permissions](docs/PERMISSIONS.md).

Debugger capability reflects successful passive target inspection, not just a declared permission. Missing, rejected or timed-out access and uninspectable tabs have unavailable coverage. Chrome or organization policy may be responsible; a generic failure cannot establish the exact cause. Detectors continue independently. Without positive evidence, a debugger coverage gap yields UNMONITORED. No active attach probe or CDP command is used.

Without `tabs`, Chrome may omit even an extension document's tab URL. The browser adapter uses `runtime.getContexts` to recognize its own packaged pages; it does not broaden access to other sites. Chrome tab IDs use the full nonnegative signed-32-bit range. DNR rule IDs are allocated separately under a serialized writer, avoiding arithmetic overflow and concurrent collisions.

## Delivery and quality

Strict TypeScript, unit tests, mocked Chrome integration tests and real Chromium unpacked-extension tests. Vite builds HTML/worker into `dist/` and serializes the self-contained sensor into a packaged classic script; packaging creates one ZIP. CSP permits packaged scripts only. Managed schema and runtime validation jointly protect configuration. Tests load the production extension and a disposable optional-DNR-pregranted fixture with unchanged executables, never a distributed edition. Native consent remains a manual check. Node 24.18 is pinned. See [implementation plan](docs/IMPLEMENTATION_PLAN.md), [acceptance matrix](docs/ACCEPTANCE.md), and [enterprise operations](docs/ENTERPRISE.md).
