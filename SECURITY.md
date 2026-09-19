# Security assumptions and limitations

AgentGuard is a local browser automation sensor and a reactive containment aid. It is not a security boundary against a malicious browser, administrator, compromised extension, OS-level automation or a user who can disable/uninstall it. Enterprise force installation, browser policy, server authorization and endpoint controls remain separate requirements.

## Data minimization

Never read or retain page text/HTML, form values, passwords, tokens, cookies, headers, screenshots, key codes, selectors or coordinates. Never persist full URLs, paths, queries, fragments, tab titles or favicons. Only canonical hostname, tab ID, static evidence, coarse event aggregates, confidence and policy outcomes are stored. Hostnames can themselves be sensitive; exports require an explicit UI action and should be handled as enterprise telemetry. No upload endpoint, analytics or remote scripts are enabled.

## Evidence is not identity

- A debugger attachment can be ordinary DevTools. `getTargets()` does not identify its owner and is not guaranteed to expose every external CDP session. No active attach probe is used.
- The single extension requires the powerful `debugger` permission, including for individual users, but uses only passive target inspection and never sends CDP commands. A compromised extension with this permission could exceed that intended use; protect distribution and review updates accordingly.
- Declared debugger permission does not guarantee usable access. Chrome or organization policy can prevent inspection; missing, rejected or timed-out API access and uninspectable tabs are reported as reduced coverage. A generic failure does not identify the exact policy responsible. Without positive automation evidence, unavailable debugger coverage yields UNMONITORED, never human or safe. Other detectors continue operating.
- If browser policy prevents installation or disables AgentGuard entirely, its code cannot run to display coverage or record events. Deployment tooling must independently verify installation and enabled state; silence from an absent extension is not evidence of safety.
- WebDriver's standard flag identifies automation behavior, not an AI vendor. Absence does not exonerate a tab. A page can spoof or suppress MAIN-world signals.
- Browser automation fingerprints change, may be forged and can appear in test tooling or unrelated page code. Framework names are hints only.
- Browser-generated trusted events are not proof of a human. CDP, accessibility tools and OS automation can generate them. Timing anomalies are weak evidence.
- Withheld site access, internal pages, unobserved iframes, short sessions, service-worker suspension and evasion cause blind spots. UNMONITORED is never displayed as safe.
- Confidence is a documented heuristic, not a statistical probability or a guarantee. AUTOMATION_LIKELY can reflect WebDriver alone; it does not identify an AI controller. NO_AUTOMATION_OBSERVED means no positive signal under current coverage, not proof of human control. ACTIVE/CONNECTED correlation is still being implemented and must not be inferred merely from debugger attachment.

## Isolation and validation

All injected results are untrusted and strictly normalized to bounded, allowlisted fields. The service worker derives domains/tab identity from Chrome, never page messages. Privileged messages are accepted only from the extension's packaged popup/options/blocked pages. There is no externally connectable entry point. Storage access is restricted to trusted extension contexts. Retention and event counts are bounded. Local logs are not cryptographically tamper evident and do not provide nonrepudiation.

Automatic document-start sensors run in an isolated top-frame world under required HTTP(S) host access. Chrome site restrictions still apply; opening the popup neither grants access nor starts detection. Sensor packets contain bounded aggregate counts and timestamps only. The worker validates exact fields, sender extension ID, top-frame document identity/lifecycle, sequence, age and rate before scheduling observation. Signals do not authorize privileged commands. The sensor stops activity collection after 100 seconds without a configuration acknowledgement. A hostile page can generate misleading synthetic events or suppress page-world evidence; these are not authenticated identity signals.

Session history stores only canonical domains, static signal identifiers, fixed timeline descriptions, timestamps and bounded counters. Current tab coverage overrides historical sessions. Loss of coverage does not mean automation ended: old observations retain only their original expiry. Active snapshots survive worker suspension. Bounded durable recovery copies are archived at full-browser restart rather than rebound to live/reused tab IDs. Both recovery copies and ended history obey age/count limits; zero history disables durable recovery too. Failed cross-area writes followed by loss of the session journal can recover only the last successful durable snapshot; failed end/clear actions are not claimed durable. History export/clear are packaged-UI-only operations. Local storage is not an integrity boundary against profile access or a compromised extension. No new security-review exclusions or severity suppressions are established by these implementation notes.

## Containment limits

Quarantine replaces the current page; optional DNR session rules affect requests reaching the network stack on hosts for which Chrome allows access. This is coarse tab containment, not per-agent request attribution. A stored quarantine is a request for containment, not proof of its current effectiveness. AgentGuard attempts to restore the packaged containment page after same-tab navigation, but the destination may load and act before that reactive replacement. CacheStorage/service workers, previously sent requests, existing connections and an agent opening new tabs limit this protection. Revoking optional permissions can reduce containment; errors/degraded capability are shown. AgentGuard never claims to pause/kill an external agent or detach its debugging connection. Closing a tab may lose unsaved work and requires a separate explicit UI confirmation. Toolbar badges describe the last assessment; the popup reads already-collected evidence with freshness checks.

## Enterprise administration

Individual and enterprise-managed deployments use the same extension artifact and manifest. Managed settings override local preferences and cannot be changed through UI messages. Invalid managed settings cause a visible configuration error, never silent policy relaxation. Managed storage contains configuration only, never secrets. Enterprise-wide aggregation requires a separately deployed and authenticated backend; this repository defines a transport interface but makes no claim to ship one.

## Reporting

Report security issues privately to your deployment's security owner. Do not include credentials or page contents. Before distribution, conduct an independent security review, validate policy deployment in supported Chrome versions, and complete Chrome Web Store/enterprise review. This repository does not claim certification.

## Primary references

- [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Permissions and non-optional debugger permission](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Scripting execution worlds](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome extension security](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)
- [DNR scope and limitations](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [Service worker lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [WebDriver standard](https://www.w3.org/TR/webdriver/)
- [CDP input dispatch](https://chromedevtools.github.io/devtools-protocol/1-3/Input/)
