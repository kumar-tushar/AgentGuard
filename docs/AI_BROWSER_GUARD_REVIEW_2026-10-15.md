# AI Browser Guard versus AgentGuard

Review date: 15 October 2026. This is a product, architecture and implementation comparison, not a certification or an exhaustive adversarial security audit.

## Executive conclusion

AI Browser Guard is ahead in end-user feature breadth: delegation presets, per-agent grants, a global emergency shortcut, session reports, lifetime statistics, download handling and an optional network-activity view. These are real implementation advantages, not just screenshot decoration.

AgentGuard has the stronger foundation for its stated enterprise requirements in the areas inspected: explicit detection coverage, conservative identity claims, privacy-minimized records, document-bound observations, bounded/deduplicated session state, managed configuration and a dedicated administration/settings surface. That does not establish that AgentGuard detects more real agents or has a lower measured false-positive rate. Neither product has a comparative accuracy benchmark.

Recommendation: close the session-reporting, activity-correlation and emergency-workflow gaps first. Add delegation only with explicit enforcement coverage. Do not copy AI Browser Guard's vendor attribution or installed-release download attribution as-is.

## 1. Exactly what was reviewed

Four separate baselines were examined:

| Baseline | Identity | How it was used |
| --- | --- | --- |
| Installed competitor | AI Browser Guard 0.7.0, extension ID `ojphpdmabflmcjhglfogmkdgchkncikf` | Static installed package; the supplied screenshot/appshot; release rebuild; disposable-browser controls |
| Matching public release | [`b17a21a8586d1dcd14797d91647af8e040735d8b`](https://github.com/opena2a-org/ai-browserguard/tree/b17a21a8586d1dcd14797d91647af8e040735d8b), tagged `v0.7.0` | Primary source for installed-product findings |
| Newer public source | [`2811712fe4186baaa3a6b6ef7aa1474020ec3a0b`](https://github.com/opena2a-org/ai-browserguard/tree/2811712fe4186baaa3a6b6ef7aa1474020ec3a0b) | Separately labeled newer capabilities; not assumed installed |
| AgentGuard | Current local 0.1.0 source, including existing Orbit-icon changes | Actual implementation and tests, not planned features |

The public repository is Apache-2.0 licensed. Source was obtained successfully and kept under ignored `artifacts/reviews/`; no competitor code was copied into AgentGuard's runtime. Dependencies were installed with install scripts disabled. No employee cookies, passwords, history, extension session storage or live browsing contents were read. Browser controls used a fresh temporary Chromium profile, not the employee's Chrome profile.

### Installed-package provenance

Rebuilding the release reproduced these six installed files byte-for-byte, including inline source maps:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `background/index.js` | 569914 | `ff83182a5cdddb65dc4eaae432f9766ca866b3555c796e45dd546cec6e4514d9` |
| `content/index.js` | 269335 | `1a11517734e00330bcf9203bb24c11d8adddc7778cca1d29dd353dc683d4a346` |
| `content/interceptor.js` | 113866 | `6f3ded2c2a59434a817e6e7c9db17fd601965486ca84bac447db8ef9fd35ee57` |
| `popup/popup.js` | 360942 | `1e5c2ca7ad7d0c1254a95ac81f876efaf82719d743ac0bce1bddac68f2d2ff9e` |
| `popup/styles.css` | 25027 | `984ee7eb4a4b98c109b83f6af04c585f1253447e1ef6d83ada4033ab1d0fd194` |
| `popup/index.html` | 4138 | `12299ca385e1c73cef6f7ce74a4827f305eb040290253813c8aa2798f0349a80` |

Chrome adds distribution metadata to the installed manifest; this is not a claim that its entire installation directory is byte-identical to `dist/`. Both public snapshots still call themselves 0.7.0. A version string alone is therefore insufficient to attribute the newer source's behavior to the installed extension.

## 2. Feature-by-feature comparison

“Not implemented” means absent from the inspected runtime, even if contracts or documentation describe future work. “Stronger” is an engineering judgment limited to the dimension in the row.

| Area | Installed AI Browser Guard | Current AgentGuard | Assessment |
| --- | --- | --- | --- |
| MV3 distribution | One extension and manifest | One extension and manifest, one `dist/` | Both satisfy the single-product requirement |
| UI technology | TypeScript and DOM rendering | TypeScript and React | Neither technology establishes product quality |
| Detector composition | Separate technique modules, central orchestration | Common detector interface and registry, sanitized adapters | AgentGuard matches the requested extension architecture more closely |
| Passive debugger detection | Browser-wide target inspection and polling | Shared snapshot, per-tab coverage and passive history | Both useful; no owner identity from either |
| Debugger unavailable | Returns non-detection with a detail string | Explicit unavailable/error coverage; no positive signal means UNMONITORED | AgentGuard communicates uncertainty more reliably |
| WebDriver | Standard flag, anomalies, Selenium markers | Standard flag plus separately maintained fingerprint registry | Competitor has more heuristics; accuracy advantage unproven |
| Runtime fingerprints | Broader global, environment and stack patterns | Small existence-only allowlist, explicit provenance | Breadth versus tighter validation/privacy |
| Real framework validation | Puppeteer/Selenium harnesses; some other patterns synthetic | Real Chromium WebDriver and Playwright binding fixtures | Neither validates every advertised vendor/version |
| Stack instrumentation | MAIN-world API/error-stack interception | Not implemented | Competitor capability lead, with false-attribution/compatibility risks |
| Environmental heuristics | Linux, renderer, dimensions, plugins | Not implemented | Additional weak hints, not reliable vendor identity |
| Behavioral analysis | Timing, coordinates, precision, synthetic events | Coarse bounded counts/intervals | More competitor features; AgentGuard collects less sensitive data |
| Scoring | Ordinal confidence; multiple positives upgrade it | Numeric heuristic, maxima within correlated families | AgentGuard better resists straightforward correlated-signal inflation |
| AI/controller identity | Framework/vendor labels inferred heuristically | Verified controller remains null; framework hints separate | AgentGuard more faithful to evidence limits |
| Automatic inventory | Content sweeps and browser-wide debugger scans | Startup inventory, tab/navigation lifecycle and bounded reconciliation | AgentGuard has more explicit lifecycle/freshness handling |
| Evidence freshness | Installed active registry can outlive attachment; count-change polling | TTL, document invalidation, UI expiry, unavailable coverage | AgentGuard stronger in inspected paths |
| Session identity | Timeline and local sessions; repeated-positive duplication reproduced | Stable, deduplicated session IDs and bounded transitions | AgentGuard stronger session bookkeeping |
| Observed action timeline | Some in-page events and blocked API calls, not all external-driver activity | State/evidence timeline; sensor activity not integrated into counters yet | Competitor richer useful activity surface, but incomplete |
| Ended-session reports | Report modal and JSON export; counts, duration, violations, network summary | Ended history/export; no equivalent report experience | Clear competitor lead |
| Lifetime summary | First-active date, sessions, blocks, most-seen framework | No equivalent aggregate dashboard | Competitor UX lead; session-count correctness matters |
| Network activity | Optional armed fetch/XHR/beacon observation | No equivalent traffic timeline | Competitor feature lead, not a full network monitor |
| Delegation presets | Read-Only, Limited, Full Access | Not implemented | Clear competitor lead |
| Scope/time/grants | Site patterns, expiry, session and per-agent rules, revoke | Monitor/warn/block sensitive-domain policy | Different controls; competitor more granular |
| Sensitive sites | Configured site rules plus heuristic severity escalation | Canonical domain-boundary matching and managed sensitive-domain settings | AgentGuard more enterprise-oriented; competitor presets more flexible |
| Action boundaries | Selected in-page APIs/events, best effort | No per-action sandbox | Competitor feature lead, not universal prevention |
| Emergency action | Multi-tab kill switch, persisted latch, reset, keyboard command | Explicit close or quarantine for a chosen tab | Competitor much faster for a multi-tab emergency |
| Browser-layer blocking | Opt-in active CDP/Fetch for explicit blocked sites | Optional per-tab DNR plus page replacement | Different boundaries; neither is complete DLP |
| Download control | Downloads API and delegation checks | No downloads permission or download manager | Competitor capability lead, installed attribution unsafe |
| Recovery overrides | Allow once and whitelist controls | Release quarantine, no equivalent one-shot action grant | Competitor broader; whitelist toast path fails sender gate |
| Unpinned awareness | Boundary toasts and Chrome notifications for certain events | Stacked cross-tab positive-detection notices, activate-and-mute 24 hours | AgentGuard's requested cross-tab workflow is implemented; not equivalent to OS notifications |
| Branding | Shield/badge and status text | Green/red Orbit icons with no overlay text, shared UI branding | AgentGuard already matches the requested icon behavior |
| Settings usability | Settings and wizard inside the popup | Dedicated options page with overview, sessions, policy, coverage, audit | AgentGuard better suited to detailed administration; competitor more compact |
| Local privacy | Full action/request URLs, selectors, download labels; key strings temporarily buffered | Canonical hostnames, fixed evidence and bounded aggregate metadata | AgentGuard materially more data-minimized |
| Retention | Default 5 sessions, 100 detections, 20 reports; report TTL pruned on write | Bounded sessions, audit and passive history, age filtering and restart recovery | Both have retention; AgentGuard has more systematic hard bounds |
| Managed configuration | No managed schema or managed-policy consumption found | Managed schema, precedence, validation, locked UI settings | Clear AgentGuard enterprise-configuration advantage |
| Backend integrations | Optional type-based AIM/registry lookups and contributions | Future integration contracts, no active transport | Competitor has more implemented connectors, not an organization inventory |
| Fleet view/RBAC | Not implemented in extension repository | Not implemented | Neither answers the organization-wide question yet |
| Integrity of audit | Mutable local session/report storage | Mutable local bounded audit/export | Neither provides tamper-evident enterprise evidence |
| Testing | Large unit/mock/DOM suites and framework/smoke scripts | Unit/integration suites and production-extension Playwright tests | Count alone cannot rank detection accuracy or production reliability |

AgentGuard evidence: [architecture](../ARCHITECTURE.md), [manifest](../src/manifest.ts), [scoring](../src/detection/scoring.ts), [sessions](../src/background/agent-sessions.ts), [observation mapping](../src/background/session-observation.ts), [configuration](../src/enterprise/config.ts), [containment](../src/background/containment.ts), [alerts](../src/background/tab-alerts.ts) and [browser tests](../tests/e2e/extension.spec.ts).

## 3. What AI Browser Guard genuinely does better

### Delegation is a more complete employee workflow

The wizard turns an abstract policy into a recognizable grant: what actions, which sites and for how long. An agent-specific grant overrides the session grant. Revocation and expiry exist. Full Access is time-bounded to 60 minutes; Read-Only has no default expiry. This is substantially richer than AgentGuard's monitor/warn/block model.

However, listing a capability in a preset does not mean Chrome can enforce it against every controller. External CDP/WebDriver native input bypasses page-level event interception. The product's enforceability module and reports acknowledge this. A future AgentGuard wizard should show each permission as enforced, best-effort or observed-only, not call an external driver “read-only” without that qualification. [Release rules](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/delegation/rules.ts), [enforceability](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/delegation/enforceability.ts).

### Reports make the monitoring value easier to see

The popup exposes timelines, ended-session reports, action/violation counts, duration and a lifetime summary. This directly explains the richer screenshot. Report coverage explicitly warns that native CDP input is not observable; zero actions is not proof that nothing happened. AgentGuard currently has stronger state accounting but has not connected its document-bound activity sensor to session counters and has no equally useful post-session summary.

Network activity is another useful investigative aid, but the release observes selected page-world APIs only while delegation or the kill switch arms collection. Initiator classification comes from stack heuristics. No matching automation stack is labeled user, which is not authenticated human attribution. It is not a complete browser traffic capture. [Reports](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/session/report.ts), [network interceptor](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/content/network-interceptor.ts).

### Emergency access is significantly faster

The kill switch is available from the popup and a Chrome keyboard command, closes registered agent tabs, disables delegations, ends sessions and retains a latch until reset. That is useful when several tabs are involved. AgentGuard requires a chosen-tab quarantine or close action and has no global shortcut.

The hard stop is tab closure, not termination of an external controller. A controller may create another tab. Rewriting `navigator.webdriver` or deleting marker globals does not stop it. Incorrect or stale agent classification can also cause the kill switch to close a human-used tab. [Kill-switch implementation](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/killswitch/index.ts).

### Additional signals and integrations are implemented

MAIN-world stack inspection and wider Selenium/environment patterns give the competitor more opportunities to observe automation. Optional site declarations, trust lookups and consented contribution also exist. Four outbound feature families are off by default. Type-based registry scores are not proof that the entity controlling a current tab has that identity. AIM/registry configuration fields exist, but those two lookups have no settings toggle in the inspected UI. `autoBlockUnknownAgents` and `autoBlockUntrustedAgents` are stored settings without an implemented runtime enforcement consumer in the release.

A site's `ai-safety.txt` declaration is self-asserted and display-only, not a trusted policy authority. Its fetch path does have useful HTTPS, redirect, credential, size and timeout restrictions. [AIM client](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/aim/client.ts), [registry client](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/registry/client.ts), [site-declaration client](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/aisafety/client.ts).

## 4. Reproduced competitor problems and material limitations

### A. Repeated detections inflate the session count

In a disposable real Chromium run with the unmodified release build, standard Playwright instrumentation and one persistent localhost fixture, the lifetime session count was **3 → 6 → 9 → 12** across four observations approximately 5.5 seconds apart after the initial sample. The startup blank page contributed to the initial count; later retained records repeatedly named the same fixture. There were no fixture interactions. Session IDs and agent IDs changed and previous records remained unended until evicted by the five-session limit.

The source explains the behavior: each positive sweep creates a new agent UUID, the monitor compares that UUID to the last one, and the background creates a new session for each detection. This is a reproduced accounting problem, not just a theoretical concern. It does not prove exactly how the employee's 474 count accumulated; it does show that it cannot be assumed to mean 474 distinct agents or independent sessions. [Detector](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/content/detector.ts), [background handler](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/background/index.ts#L793).

### B. Ordinary page metadata can produce “confirmed” framework attribution

A synthetic source control supplied a manually inspected attached page titled “Playwright documentation” plus a normal DevTools target. The result was `playwright`, confidence `confirmed`. The detector searches attached targets' titles/URLs and treats a vendor word as a signature. It also combines metadata across targets, so a framework hint is not necessarily specific to the tab receiving it.

The same controls showed an ordinary function named `callFunction` producing high-confidence Selenium attribution. A Linux virtual-desktop fingerprint with a software renderer and common resolution simultaneously matched the Anthropic Computer Use and OpenAI Operator detectors at medium confidence. These controls demonstrate non-unique features, not measured real-world false-positive rates. [Debugger detector](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/detection/cdp-debugger.ts), [stack detector](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/detection/stack-trace.ts), [environment detectors](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/detection/automation.ts).

### C. Installed download attribution can affect an unrelated employee download

With one registered agent on `agent.example`, a download from unrelated `unrelated.example` is assigned to that agent with `matchedByReferrer: false`. With multiple agents the final fallback chooses the first one. The installed handler still cancels a download attributed this way when its selected delegation denies downloads.

It marks the event blocked before cancellation is confirmed and swallows cancellation failures. The control reproduced the attribution decision; the cancellation consequence is verified from source, not a live employee download experiment. Even a hostname match is not proof of tab origin. This is a feature AgentGuard should implement only after adopting reliable attribution or an explicitly tab-wide/user-approved policy. Newer source improves this substantially; do not confuse that fix with the installed release. [Attribution](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/background/download-monitor.ts), [download handler](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/background/index.ts#L1299).

### D. The whitelist toast's message is rejected

The in-page toast sends `DOMAIN_WHITELIST` from a content-script sender. The background classifies that message as popup-only and rejects senders with `sender.tab`. A synthetic control using Chrome's content-sender shape returned false. The button therefore does not have a working end-to-end authorization path in this release. This finding does not mean the sender gate should be broadly relaxed; a narrowly scoped validated command would be needed. [Toast](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/content/toast.ts), [sender gate](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/background/sender-validation.ts).

### E. Broader detectors do not mean complete detection

The content orchestrator runs in ISOLATED world; ordinary page MAIN-world globals are not automatically the same JavaScript globals. The MAIN interceptor supplies a separate stack channel, not a complete MAIN-world version of every global detector. Initial content detection also waits for DOMContentLoaded, despite document-start script installation. The main API interceptor skips insecure contexts; localhost is a secure-context exception, so the browser control does not validate ordinary remote HTTP coverage.

Behavioral-only detection sets the verdict flag but does not construct the agent object required by the outgoing detection handler, leaving that path incomplete. Keyboard analysis is nested behind sufficient mouse samples. The debugger fast poll reacts to changes in attached-target count, not every identity change; equal-count replacements wait for another reconciliation path. The installed registry has no general detach/navigation freshness mechanism equivalent to AgentGuard's TTL and document generations. These are source-level findings, not a benchmark of every browser state.

### F. Collection is more invasive than AgentGuard's requirement

The release keeps actual `KeyboardEvent.key` strings temporarily in its behavioral buffer without a password-field exclusion. That is not evidence that passwords are persisted or transmitted, but it conflicts with AgentGuard's requirement never to collect sensitive key/form values. Coordinates and element rectangles are also buffered. Stored events include full URLs, selectors and download filenames/addresses; URLs can themselves carry tokens or personal data. Network body-size estimation examines FormData string lengths and may stringify object bodies, although event payloads contain size rather than body contents.

Reports keep up to 20 entries and prune older-than-30-day entries when a new report is written, not via guaranteed wall-clock deletion. Session counts are limited by settings, but per-session events are not equivalently hard-bounded. AgentGuard should keep its existing hostname-only, fixed-label and bounded-metadata model when adding reporting. [Collector](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/content/detector.ts#L210), [timeline](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/session/timeline.ts), [current published disclosure](https://opena2a.org/aibrowserguard/privacy).

### G. Enforcement is intentionally incomplete

Page API wrapping is mutable and covers selected sinks, not every DOM write, browser request or native input. The MAIN bridge also depends on a page-world bootstrap ordering assumption; a MessagePort does not authenticate an AI controller. Allow-once grants are separate in MAIN and ISOLATED paths, rather than a single centrally consumed, document-bound authorization. Pending overrides are not a durable universal grant system.

Optional CDP/Fetch enforcement is stronger than page wrappers for explicit blocked destinations, but is tab-wide, not agent-specific. Installed 0.7.0 attaches only for a delegation with a blocked-site pattern; enabling the setting alone is insufficient. Its source documents WebSocket gaps. Attach refusal falls back to page enforcement, which must not be presented as equivalent coverage. Some release comments about single debugger clients are outdated; attach behavior must be tested on supported Chrome versions rather than inferred from those comments.

AgentGuard is not a complete network sandbox either: its current DNR regex is HTTP(S)-only, so merely listing a `websocket` resource type does not make it cover `ws:`/`wss:`. Page replacement is reactive, not prevention of every preceding request. Neither extension terminates an external process or prevents new tabs. [Competitor CDP layer](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/src/background/cdp-enforcement.ts), [AgentGuard browser adapter](../src/background/browser.ts).

## 5. AgentGuard strengths and unfinished work

Preserve these implemented strengths:

- Failed or denied inspection is reduced coverage, not a human/safe verdict. A declared permission is not proof of usable access.
- Controller identity, framework hints, control support and coverage are separate concepts. Scores remain explicitly heuristic, not calibrated probabilities.
- Freshness, document identity and generation checks prevent old evidence from being treated as current after navigation or restart.
- Sessions deduplicate observations; active/history/timeline/audit records have explicit limits, and browser-restart recovery does not bind an old session to a reused tab ID.
- Page-originated sensor messages cannot issue policy/configuration/close commands. Privileged requests are restricted to packaged UI pages with validated payloads.
- Managed settings override employee preferences. Validation errors are surfaced rather than silently interpreted as a successful policy.
- Cross-tab alerts already work without pinning: stacked notices activate the existing source tab and mute that source for 24 hours without disabling monitoring or policy.

Do not overstate AgentGuard's current maturity:

- AGENT_ACTIVE and AGENT_CONNECTED are supported contracts/state-machine concepts but current detectors do not emit them. They are not completed high-assurance controller detection.
- Sensor events are validated and can schedule assessment, but they are not yet wired into session activity deltas or stronger control correlation. Zero counters currently do not establish inactivity.
- Fingerprint coverage is narrow. Only the verified fixtures should be advertised as tested; legacy markers need real framework/version validation.
- There is no capability delegation, global kill shortcut, download policy manager, full session-report UX or complete network-activity observer.
- The toolbar intentionally has only green and red. Green also covers unknown/unmonitored cases; it must never be marketed as a safe/human guarantee. The popup/tooltip must supply the qualification.
- Managed configuration is not a backend. Authentication, enrollment, fleet inventory, RBAC, server-side retention and tamper-evident ingestion remain unimplemented.
- Neither extension's local logs are resistant to profile access or a compromised extension. Neither has a measured cross-platform performance/accuracy advantage from this review.
- AgentGuard's browser regression run is not clean: after an initial five failures, a separate full run passed eight tests and failed two while waiting for the options tab to appear in inventory. These need investigation before release; successful unit tests do not override them.

## 6. Newer public source: useful, but not installed parity

The inspected main commit contains significant improvements beyond the byte-matched release:

- Site pauses for 15/60 minutes or until resume; global 15/60-minute pauses, resume/history and kill-switch cleanup.
- Agent-list freshness handling and more direct detection-notification workflows.
- More conservative download attribution using recent tab-scoped CDP download observations, including same-URL ambiguity handling and DevTools-related caution.
- Removal of the inert in-page whitelist button; the newer tests explicitly cover its absence.
- Browser-layer attach purposes, failures and detach reasons shown on agent cards; download observation can justify attachment even without a blocked-site pattern.
- Staged update handling that defers automatic application while a delegation or kill-switch latch is active, with pending-update UI. An explicit employee apply action can override that deferral.
- Expanded tests and documentation that more clearly separate genuine framework harnesses from synthetic signatures.

These are source-reviewed changes, not a claim that every new behavior was exercised end-to-end here. No harness in that snapshot drives real OpenAI Operator or Playwright for all advertised fingerprints; the Computer Use harness drives a Firefox probe, not the Chrome extension. The privacy page and README describe a moving source baseline, so they cannot replace inspection of the installed bytes. [Pinned newer source](https://github.com/opena2a-org/ai-browserguard/tree/2811712fe4186baaa3a6b6ef7aa1474020ec3a0b).

## 7. Permissions and platform limits

| Product | Required API permissions | Host scope | Optional API permissions |
| --- | --- | --- | --- |
| AI Browser Guard installed release | `storage`, `alarms`, `notifications`, `debugger`, `downloads` | `<all_urls>` | None declared |
| AgentGuard | `storage`, `scripting`, `alarms`, `debugger`, `webNavigation` | HTTP and HTTPS | `declarativeNetRequestWithHostAccess` |

Both require a powerful debugger permission. AgentGuard currently uses passive target inspection only; the competitor can actively attach and send CDP commands when its browser-layer setting is enabled. The absence of `tabs` in a manifest does not mean an extension with broad host access cannot see authorized tab URLs. Permissions should be assessed by capability, not count alone. [Release manifest](https://github.com/opena2a-org/ai-browserguard/blob/b17a21a8586d1dcd14797d91647af8e040735d8b/manifest.json).

Chrome's target information describes attachment state, not a cryptographically identified controller. DevTools can produce attachments, and absence of an attachment is not proof of human control. Browser restrictions and enterprise policy can prevent debugging operations; a generic failure does not prove which policy caused it. An extension that is disabled or prevented from installing cannot report its own absence. [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger).

Chrome 136 changed remote-debugging-port/pipe behavior for the default Chrome data directory; this is a browser protection, not proof that an already observed tab is contained or that all OS/accessibility automation is prevented. [Chrome's explanation](https://developer.chrome.com/blog/remote-debugging-port).

## 8. Verification and scope

Passing unit tests do not validate every advertised controller or establish detection accuracy. No assertions, tests or application code were changed for this review.

| Check | Result |
| --- | --- |
| AgentGuard `npm run check` | TypeScript passed; 427 tests in 20 files passed; production build passed |
| AgentGuard first full Playwright run, overlapping other verification | 5 passed, 5 failed; release-after-worker-restart failure, three inventory timeouts and a last-seen timestamp assertion mismatch |
| AgentGuard second full Playwright run, no overlapping test suites | 8 passed, 2 failed: browser-restart and session-UI scenarios timed out in the shared options-tab inventory setup |
| AI Browser Guard release, separate single-worker rerun | 1,043 tests in 62 files passed; strict TypeScript and production build passed |
| AI Browser Guard newer source, separate single-worker rerun | 1,441 tests in 89 files passed; strict TypeScript, 17-file prose check and production build passed |
| Release-source synthetic controls | All seven executed; results described above, including false-attribution and sender-gate counterexamples |
| Release build in disposable Chromium | Loaded successfully; repeated-session growth reproduced |
| Installed versus rebuilt release | Six files byte-identical, hashes above |

The first overlapping upstream test runs also failed: release 1,038 passed/5 failed, newer main 1,432 passed/9 failed, primarily timeouts and dependent assertions. These results are not hidden or treated as passing. Separate single-worker reruns retained the original assertions and timeouts and passed, as recorded above. Scheduling sensitivity is plausible, but this review does not establish the root cause of every failure. The remaining AgentGuard browser failures are unresolved; no fix was authorized or implemented as part of the comparison.

Commands: AgentGuard `npm run check` and `npm run test:e2e`; each upstream snapshot `npm test -- --maxWorkers=1 --minWorkers=1`, `npm run lint`, `npm run build`. Upstream builds reported an unresolved-at-build-time font reference warning; the referenced font is present in the release's packaged `dist/fonts/`. This was not a font-rendering benchmark.

The seven synthetic release-source controls cover missing debugger API, metadata-based Playwright attribution, unrelated-download attribution, whitelist sender rejection, a benign `callFunction` stack and two overlapping virtual-desktop vendor classifications. The additional real Chromium control reproduced duplicate session growth. These tests did not modify the installed employee extension.

The upstream `smoke:scope` attempt did not produce a completed result and is not counted as passed. The smaller disposable-browser control is a separate check, not a substitute claim that the full upstream smoke suite passed.

Not established by this review: real cloud Operator/Computer Use detection accuracy; complete Selenium/Puppeteer/Playwright version coverage; policy deployment on a managed Chrome fleet; all accessibility/OS automation paths; every subframe/worker/network sink; incognito behavior; long-duration retention/resource behavior; CPU/memory impact; localization/accessibility conformance; or an exhaustive adversarial security audit. AgentGuard explicitly disables incognito; competitor incognito behavior was not exercised. Neither screenshots nor test counts settle those questions.

Static packaging observation only: the release's two document-start JS files total approximately 383 KB, unminified with inline maps, versus AgentGuard's approximately 2.82 KB static sensor plus on-demand injected probes. This is not a CPU or memory benchmark and excludes other resources for both products.

## 9. Recommended AgentGuard roadmap

Before adding parity features, investigate the observed browser inventory/restart test failures and obtain a clean repeatable release-gate run without weakening assertions.

1. **Finish trustworthy activity/session correlation and reports.** Wire document-bound deltas, preserve stable session IDs, distinguish observed actions from unobservable native activity, and summarize domain-only data. Acceptance: repeated scans do not create sessions; unavailable coverage does not renew old activity; exported reports contain no keys, selectors or URL secrets.
2. **Add a scoped multi-tab emergency workflow and keyboard shortcut.** Preview affected tabs where feasible, record actual outcomes, preserve recovery after partial failures, and state that the external controller is not terminated. Never erase evidence by changing automation flags.
3. **Add delegation with an enforceability matrix.** Time-bounded presets and per-tab grants should explicitly separate native-driver observation, page-world best effort and tab-wide network enforcement. Managed policy must cap employee overrides.
4. **Expand validated signals, not vendor certainty.** Test real framework/version fixtures and benign controls; add stack hints only with false-positive guards, bounded fixed metadata, compatibility checks and conservative weights. Separate controller identity from tooling hints.
5. **Design download policy before requesting permission.** No sole-agent or first-agent fallback cancellation; no “blocked” claim before confirmation; ambiguous same-URL/same-site downloads stay unattributed unless an explicit coarse policy authorizes broader blocking.
6. **Complete enterprise ingestion as a separate backend.** Versioned sanitized events, enrollment, authentication, tenant authorization, retention, delivery/backpressure and enabled-state monitoring are required. Type-based public trust lookup does not solve organization inventory.
7. **Benchmark and release-gate both accuracy and reliability.** Include human DevTools, virtual desktops, assistive tools, multiple simultaneous agents, worker/browser restarts, denied permissions and policy-blocked inspection. Keep the single extension build and existing privacy boundaries.

The right competitive goal is not “more agent names.” It is a useful employee answer with evidence and coverage, plus dependable organization-level events an administrator can trust.
