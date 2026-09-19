# Enterprise operations and integration boundary

## Deployment

Deploy the same AgentGuard extension from `dist/` for individual and enterprise-managed users. One manifest includes required debugger permission and its broad installation warning; there is no separate enterprise edition. Local preferences and validated managed policy determine behavior. AgentGuard never attaches a debugger or issues CDP commands. A standardized WebDriver flag plus an attachment may indicate a normal test harness; it is not proof of an AI product.

Distribute a signed extension through your approved Chrome Web Store or enterprise update process. Keep a stable extension ID and protect signing credentials outside this repository. Force installation and browser restrictions are Chrome administration concerns, not capabilities implied by a local build. See [Chrome extension management policy](https://chromeenterprise.google/intl/en_us/policies/extension-settings/) and [extension policy configuration](https://www.chromium.org/administrators/configuring-policy-for-extensions/).

## Managed configuration

The following is an **extension policy payload**, not a complete device-policy file. Configure it for your deployed extension ID through the organization's supported Chrome policy mechanism. Do not put credentials, employee identifiers or service tokens in managed storage.

```json
{
  "schemaVersion": 1,
  "monitoringEnabled": true,
  "behaviorEnabled": false,
  "policyMode": "warn",
  "sensitiveDomains": ["payroll.example.com", "admin.example.com"],
  "minimumConfidence": 0.75,
  "retentionDays": 14,
  "maxAuditEvents": 1000,
  "sessionRetentionDays": 7,
  "maxHistorySessions": 50
}
```

Omit a field to allow a local preference for it. Managed keys override local preferences in the service worker and are locked in the editor. Saving other preferences preserves underlying local values for managed keys; removing a managed key restores that local preference. Domain rules match a hostname and its subdomains at DNS label boundaries. Full URLs, paths and ports are rejected. Unicode domains are canonicalized to ASCII; a `*.` prefix is normalized to the same host-and-subdomain rule. Limits: 100 domain rules, 1–90 days audit/session retention, 100–5,000 audit events, 0–500 ended sessions, threshold 0.1–1. Zero ended-session retention disables history retention, not live detection; history is separate from audit retention.

Invalid local or managed configuration is shown in the console and suspends automatic monitoring/enforcement until corrected. Existing quarantines remain releasable. Chrome schema validation may omit invalid policy before the extension sees it; validate the applied policy in `chrome://policy` as well as AgentGuard's managed locks and errors. This extension has no last-known-good enterprise-policy cache, and a deployment must not assume invalid configuration creates a fail-closed network boundary.

The manifest declares HTTP(S) host access for automatic monitoring. Managed settings do not bypass Chrome site-access restrictions; confirm effective access in Coverage & permissions and Chrome policy. No popup, pinning or Scan action is required. Network containment additionally requires optional DNR permission and is limited to hosts Chrome permits.

Chrome or organization policy may prevent debugger access despite the required manifest permission. AgentGuard checks actual passive API access and shows unavailable coverage when access fails or the tab cannot be inspected. A generic failure does not establish which policy caused it. Other detectors continue collecting available evidence; without positive automation evidence the tab remains UNMONITORED, never human or safe. Verify applied browser policy and target visibility before relying on debugger coverage.

If policy blocks installation or disables the extension itself, AgentGuard cannot report its own coverage or audit events. Verify installation and enabled state through your browser-management tooling; lack of extension telemetry must not be treated as a human/safe assessment.

## Audit data

Local audit events retain timestamp, tab ID, canonical hostname, event type, null/unverified agent identity, heuristic confidence and policy action. Event details are static allowlisted text. No page path/query, title, page contents, form values, keys, selectors, cookies, tokens or passwords are retained. The bounded log is pruned on reads, writes, scheduled refresh and export. It is not tamper-evident; users with extension/OS control can remove it.

Export is an explicit user action in the console. JSON uses the versioned `AuditEnvelope` in `src/shared/contracts.ts`. `AuditSink.write(batch)` is a backend port, with **no deployed transport or server implementation**. Before connecting one, implement enrollment and tenant isolation, authentication without exposing secrets to content scripts, HTTPS transport with a narrowly scoped permission, durable delivery/acknowledgment and deduplication by event ID, admin authorization, retention/deletion controls, and an independently reviewed agent-attestation protocol if naming agents is required. Domain telemetry can itself be sensitive.

## Pilot and release acceptance

1. Run `npm run check` and `npm run test:e2e`, then review the packaged manifest and ZIP contents.
2. Load the single extension on a dedicated test profile. Verify ordinary browsing, Chrome DevTools, your approved automation tools, and your actual agent products. Measure false positives before setting a blocking threshold.
3. Verify managed keys are locked, malformed policy is visible, and local edits cannot weaken managed values. Verify effective host access and browser-level restrictions on each supported OS.
4. Test permission denial/revocation, organization restrictions on debugger access, worker suspension, sleep/wake, tabs navigating while scans run, inaccessible frames, and browser restarts. Confirm unavailable debugger access produces reduced coverage, not a human/safe claim. Session quarantines are cleared by a full browser restart; page replacement cannot undo prior requests.
5. Test quarantine, attempted same-tab navigation, release, and close against representative sensitive sites. Restoration after a navigation is reactive; the destination may load or act before AgentGuard replaces it. DNR rules cannot cover ungranted hosts, CacheStorage/service-worker responses or every already-open connection.
6. Confirm UI, badges and logs do not name an AI vendor from heuristic signals. Badges describe the last assessment; open the popup for fresh evidence.

Background refresh inventories all tabs and processes them four at a time using one shared debugger-target snapshot. Assessment retention is capped at 500 and capacity warnings are explicit; event bursts are coalesced. There is no manual-scan fallback. Top-frame probes do not provide universal iframe visibility. A compromised browser or OS is outside this extension's trust boundary. Expanded session/correlation/alert features remain under implementation; check CODEX_HANDOFF.md before deployment.
