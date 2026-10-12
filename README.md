# AgentGuard

A Chrome Manifest V3 extension for explainable browser automation monitoring, local audit, and reactive sensitive-domain protection. TypeScript, React, Vite, Vitest and Playwright. No backend, analytics or remote code is enabled.

AgentGuard cannot reliably identify an arbitrary AI product. It answers with observed evidence, heuristic confidence, coverage gaps, and a qualified status. It never interprets missing signals as proof that a tab is safe.

## Install locally

Requires Node.js 24.18 (pinned in `.nvmrc`), npm and Chrome 120+. The dependency set also supports Node 22.22.2+ and 26+. Node 20 cannot run the DOM test environment.

```sh
npm ci
npm run check
```

Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose the generated `dist` directory. AgentGuard automatically monitors accessible HTTP(S) tabs, including tabs already open at installation. Pinning or opening its popup is not required. The popup reads stored assessments; it never starts a scan.

Automatic monitoring uses required HTTP(S) host permissions. Chrome site-access settings and organization policy can still withhold access; restricted pages remain unmonitored. Settings → Coverage & permissions explains actual coverage and links to Chrome site settings. In Policy settings, add sensitive hostnames and select Monitor, Warn, or Block. The default records evidence without quarantining tabs.

AgentGuard has one source tree, one manifest and one extension build in `dist/`, for both individual and enterprise-managed users. The powerful **required debugger permission** enables passive attachment signals; Chrome does not allow this permission to be requested optionally. Enterprise behavior is configured through managed policy, not a separate edition.

## Understand the result

| Internal state | Employee-facing meaning |
| --- | --- |
| AGENT_ACTIVE | Strong automation evidence with recent correlated activity; not verified AI identity. Correlation pipeline is still being implemented. |
| AGENT_CONNECTED | Strong automation evidence remains without recent activity. Correlation pipeline is still being implemented. |
| AUTOMATION_LIKELY | Strong automation evidence, including a positive WebDriver flag. Does not establish AI intent or identity. |
| AUTOMATION_SUSPECTED | Weak or ambiguous positive automation signals; investigate supporting evidence. |
| NO_AUTOMATION_OBSERVED | No positive signal in current available runtime and debugger observations. Never proof of human control or safety. |
| UNMONITORED | Insufficient, stale or unavailable coverage. Never means safe. |

The evidence score is heuristic support, not a calibrated probability. WebDriver and fingerprints share one correlated family; repeated markers do not inflate confidence. Behavior alone remains weak suspicion. Evidence expires after at most 90 seconds, with recent trusted activity expiring after 30 seconds. Chrome or organization policy may prevent debugger inspection despite its manifest permission. Unavailable debugger access is reported as reduced coverage: without positive automation evidence, the result is UNMONITORED, never human or safe. Other available detectors continue contributing evidence.

The toolbar shows only a **green or red shield**, without text badges or symbol overlays. Positive automation assessments, policy warnings and quarantine turn it red; otherwise it stays green. Green is not proof of safety: check the tooltip or popup for unmonitored/reduced coverage.

Small top-right notifications stack vertically on the active accessible web tab in each window, even when AgentGuard is unpinned. Each card identifies an automated tab by hostname and tab ID, with its qualified state and evidence score—not verified controller identity. **Click a card to switch to that existing tab and hide its notifications for 24 hours** (keyboard: focus it and press Enter/Space). The mute applies to that source tab across all stacks; other cards remain. It survives reloads, same-tab navigation and background-worker restarts; closing/replacing the source tab or restarting the browser ends it. Detection, audit and policy enforcement continue. If switching or saving fails, no successful mute is claimed; the tab may already have switched when saving fails. Restricted pages or withheld access can prevent notifications, and hostile pages can hide or spoof them. Use the extension's popup for authoritative stored evidence.

Settings → Coverage & permissions includes bounded passive debugger history: first/last observations, sampled attachment changes and target disappearance. It never identifies the debugger owner. Lost access shows unavailable coverage, not detachment; attachment sample spans are not exact connection durations. This history lasts only for the browser session and does not increase detection scores.

The popup shows evidence, coverage, unverified framework hints, policy decisions and emergency controls. **Quarantine** replaces the current page, potentially losing unsaved work. With optional network-blocking permission and persistent host grants, it also blocks HTTP(S) network requests in that tab on granted hosts. **Release** removes containment without restoring the original URL. **Close tab** closes the real tab after confirmation. None of these terminates an external controller or prevents it from opening other tabs.

## Development and verification

```sh
npm run typecheck             # strict TypeScript
npm test                      # unit and integration tests
npm run build                 # single extension → dist/
npx playwright install chromium
npm run test:e2e              # builds and loads the real unpacked extension
npm run dev                  # rebuild extension on changes; reload it in Chrome
```

Browser tests exercise automatic monitoring and in-page alerts without a popup or pinning, per-tab 24-hour dismissal, MAIN/ISOLATED probes, policy, recovery after worker termination, data minimization, passive debugger inspection, and DNR containment. Network-blocking tests use a disposable copy with optional DNR pregranted at installation; executable files are unchanged. Native consent dialogs and real enterprise policy deployment still require manual release checks.

`npm run check` runs type checking, unit/integration tests and the single production build. `npm run package` also runs browser tests and creates one versioned ZIP archive, `artifacts/agentguard-<version>.zip`, from `dist/`. It requires Chromium installed by Playwright and the `zip` executable (included on macOS and the Linux CI runner). The ZIP contains only built extension files. No signing key or Chrome Web Store account is included.

## Enterprise operation

Managed settings in `chrome.storage.managed` override local preferences and are locked in the UI. The schema is `public/managed-schema.json`; an example and deployment checklist are in [enterprise operations](docs/ENTERPRISE.md). The extension applies managed precedence in its service worker, independently of the UI.

The console shows **this browser**, not a fictitious organization-wide inventory. Bounded local audit and automation-session history support explicit sanitized JSON exports. Session history defaults to 50 ended sessions or seven days, whichever limit applies first; local or managed settings can change those bounds. Active sessions survive service-worker suspension, and current coverage always takes precedence over historical observations. The versioned `AuditEnvelope`, `SessionReport` and provider contracts form the boundary for a future backend. Shipping organization-wide telemetry requires a separately implemented authenticated transport, server, enrollment, and authorization model.

## Design and limits

- [Architecture](ARCHITECTURE.md) — repository modules, trust boundaries, scoring and worker lifecycle.
- [Security assumptions](SECURITY.md) — evasion, false positives, privacy, identity and containment limits.
- [Permission rationale](docs/PERMISSIONS.md) — every required and optional permission.
- [Runtime fingerprints](docs/RUNTIME_FINGERPRINTS.md) — versioned allowlist, verified fixtures and unverified legacy markers.
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md) and [acceptance criteria](docs/ACCEPTANCE.md) — all 18 modules.

The expanded product is under implementation; consult [the current checkpoint](docs/CODEX_HANDOFF.md). Stacked cross-tab notifications are implemented; stack/environment sensors, stronger activity correlation, delegation and the real-tool detection matrix are not complete. Do not treat passing tests of implemented modules as completion of those features. AgentGuard does not claim certification, universal agent detection, tamper-proof logs or complete data-loss prevention.
