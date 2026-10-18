# AgentGuard local parity delivery — 2026-10-16

One product, source tree, manifest, `dist/` and versioned ZIP remain. No separate enterprise edition, dependency changes, backend deployment, commits or pushes. Existing uncommitted Orbit work is preserved. This is a tested local feature expansion, not a claim that the entire product roadmap is complete.

## Delivered behavior

- Accepted document-bound activity batches count once; password-field browser fixtures verify that only counters survive.
- Per-session report/JSON, bounded timeline summaries and stable-session lifetime statistics; no invented controller identities or inactivity guarantees.
- Multi-tab emergency quarantine/close, persisted latch, actual outcomes, failure visibility and global shortcut. Cleanup failures do not skip remaining tabs. Reset does not release old quarantines.
- Read-Only/Limited/Full Access presets, destination scopes, expiry, revocation, site/global pauses and managed caps that shorten existing grants without reviving them later.
- Best-effort selected page API/synthetic-event boundaries and document/realm-bound 60-second single-use exceptions. These do not restrict every native driver or bypass sensitive-domain/DNR policy.
- Separate optional DNR egress rules with deny precedence, websocket handshake coverage and legacy quarantine-rule preservation, including high tab-ID collisions.
- Explicit metadata-only CDP observation leases. Refusal/loss is unavailable coverage. Own-attachment epochs/journal prevent self-detection across races/worker restart; recovery detaches rather than silently reattaching.
- Optional browser-wide download observation/cancellation with actual callback outcomes, never guessed tab/agent attribution. Optional generic desktop alerts validate fresh source tabs on activation.
- Optional fixed-label stack hints (real Playwright fixture; Puppeteer synthetic only), conservative family scoring and no generic callFunction→Selenium assertion.
- Manual, off-by-default AIM/registry protocol lookups, display-only site declaration checks and consented aggregate contributions to configured HTTPS endpoints. No hidden/public default service, credentials, provider identity claims or organization backend.
- Serialized staged updates with idle deferral and explicit active-control reload confirmation.

## Build and permissions

Build: `npm run build` → `dist/`. Full verification/package: `npm run package` → `artifacts/agentguard-0.1.0.zip`. Load the folder for Chrome's Load unpacked; use the ZIP for a distribution submission after release acceptance.

Required APIs: `storage`, `scripting`, `alarms`, `debugger`, `webNavigation`. Required hosts: `https://*/*`, `http://*/*`. Optional APIs: `declarativeNetRequestWithHostAccess`, `downloads`, `notifications`. The shortcut uses a manifest command, not another permission. See PERMISSIONS.md for rationale and INTEGRATIONS.md for outbound contracts.

Final serial `npm run package`: strict TypeScript passes, all 465 unit/integration tests in 30 files pass, all 16 Playwright scenarios pass (1.2m), the single build and ZIP succeed. Archive integrity passes and all 22 ZIP files match current dist bytes. SHA-256: `87178249a23ea4e05d5398bb551e7aaacf8b633ac28d106ee6aa0f50b177ddf4`. No tests were disabled or removed. The asynchronous UI assertion now waits for the same expected loaded data, and network assertions were strengthened rather than suppressed. All SECURITY changes were previewed, explicitly approved and applied; root-only scope rechecked. Native consent/OS delivery, managed fleet policy and chosen service compatibility are not established by mocks or headless tests.

## Files added

```text
docs/AI_BROWSER_GUARD_REVIEW_2026-10-15.md
docs/INTEGRATIONS.md
docs/PARITY_IMPLEMENTATION.md
docs/PARITY_DELIVERY_2026-10-16.md
src/background/activity.ts
src/background/debugger-ownership.ts
src/background/downloads.ts
src/background/egress.ts
src/background/emergency.ts
src/background/notifications.ts
src/background/statistics.ts
src/background/traffic.ts
src/background/updates.ts
src/content/boundary.ts
src/delegation/store.ts
src/integrations/client.ts
src/session/reports.ts
src/shared/controls.ts
src/shared/emergency.ts
src/shared/integrations.ts
src/shared/reports.ts
src/shared/traffic.ts
src/shared/updates.ts
src/ui/delegation.tsx
src/ui/emergency.tsx
src/ui/integrations.tsx
src/ui/report.tsx
src/ui/traffic.tsx
src/ui/updates.tsx
tests/activity.test.ts
tests/boundary.test.ts
tests/delegation.test.ts
tests/egress.test.ts
tests/emergency.test.ts
tests/integrations.test.ts
tests/reports.test.ts
tests/stack.test.ts
tests/traffic.test.ts
tests/updates.test.ts
```

## Files modified

This working-tree inventory includes preserved earlier Orbit branding changes, not just newly authored parity changes.

```text
ARCHITECTURE.md
README.md
SECURITY.md
docs/ACCEPTANCE.md
docs/CODEX_HANDOFF.md
docs/CODEX_STATE.json
docs/ENTERPRISE.md
docs/PERMISSIONS.md
docs/RUNTIME_FINGERPRINTS.md
public/managed-schema.json
scripts/icons.ts
src/background/agent-sessions.ts
src/background/browser.ts
src/background/containment.ts
src/background/debugger-intelligence.ts
src/background/messages.ts
src/background/session.ts
src/background/worker.ts
src/content/runtime.ts
src/detection/engine.ts
src/enterprise/config.ts
src/manifest.ts
src/shared/contracts.ts
src/shared/fingerprints.ts
src/ui/blocked.tsx
src/ui/components.tsx
src/ui/options.tsx
src/ui/popup.tsx
src/ui/sessions.tsx
src/ui/styles.css
tests/browser.test.ts
tests/containment.test.ts
tests/debugger-intelligence.test.ts
tests/e2e/extension.spec.ts
tests/icons.test.ts
tests/messages-settings.test.ts
tests/ui.test.tsx
tests/worker.test.ts
vite.config.ts
```

Removed source files: none. Generated `dist/` and ZIP are rebuilt and Git-ignored; there is no `dist-enterprise/`.

Production-build Agent controls, Traffic & alerts and External services panels were visually inspected at 1280×900 in a disposable browser profile. Screenshots are Git-ignored under `artifacts/agentguard-parity-{controls,traffic,services}.png`. The first screenshot helper ran before the fixture assessment existed; it was corrected to await the real stored assessment (as the browser tests do), without changing production code or test assertions.

## Remaining work / non-claims

Comprehensive boundary-violation telemetry and authenticated activity/controller correlation are incomplete; report counts are explicitly qualified. Weak Linux/software-rendering patterns are not promoted to named AI identity. Real Selenium/Puppeteer/OS tools, ordinary headed Chrome/DevTools, native notifications/consent, managed policy, long-duration compatibility/performance and independent security review remain release work. Organization inventory requires a separately designed authenticated backend, enrollment, tenant authorization and delivery/retention model. Neither optional type lookups nor aggregate contributions supplies it. No extension action terminates an external controller or provides complete DLP.
