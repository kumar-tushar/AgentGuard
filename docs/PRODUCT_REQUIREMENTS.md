You are now the principal engineer, browser-security researcher,
Chrome-extension architect, detection engineer, enterprise-security
engineer, test engineer, and senior product/UI designer for AgentGuard.

You are working on the EXISTING AgentGuard repository supplied with this task.

DO NOT create a new repository.
DO NOT rewrite the project from scratch.
DO NOT discard working functionality.
DO NOT create separate consumer and enterprise versions.

There is ONE AgentGuard extension, ONE manifest, ONE source tree,
ONE dist/ build, and ONE packaged ZIP.

Individual versus enterprise behavior is controlled by configuration
and Chrome managed policies, not separate builds.

======================================================================
FIRST: IMPORTANT CODEX CONTINUITY PROTOCOL
======================================================================

The user's Codex usage limit may expire approximately hourly.

Therefore THIS REPOSITORY, NOT CHAT HISTORY, MUST BE THE SOURCE OF TRUTH
FOR CONTINUATION.

Before doing substantive implementation work, create:

docs/CODEX_HANDOFF.md
docs/CODEX_STATE.json

These files are mandatory and must be maintained throughout the work.

--------------------------------------------------
docs/CODEX_HANDOFF.md
--------------------------------------------------

It must always contain:

# AgentGuard Codex Handoff

## Overall Objective
One concise description of the final product.

## Current Phase
The current implementation phase number and name.

## Completed
Exact work completed so far.

## In Progress
What was being implemented most recently.

## Next Exact Task
The SINGLE exact task Codex should do next.

This must be detailed enough that another Codex session with no chat
history can immediately resume.

## Files Changed
Files added/modified/removed during the current phase.

## Architecture Decisions
Important decisions already made and why.

## Tests Last Run
Exact commands and results.

Example:

npm run typecheck
PASS

npm test
341 passed, 0 failed

npm run build
PASS

npm run test:e2e
12 passed, 0 failed

## Known Failures
Any failing test, incomplete implementation, or technical blocker.

## Manual Tests Required
Tests that require real Chrome / Claude / Codex / Selenium etc.

## Do Not Redo
Work already completed that future sessions should not repeat.

## Resume Instructions
The exact command/file/function/test where Codex should continue.

--------------------------------------------------
docs/CODEX_STATE.json
--------------------------------------------------

Maintain a machine-readable state similar to:

{
  "schemaVersion": 1,
  "phase": 4,
  "phaseName": "Detection engine",
  "status": "in_progress",
  "lastCompletedMilestone": "...",
  "currentTask": "...",
  "nextTask": "...",
  "filesInProgress": [],
  "tests": {
    "typecheck": "passed",
    "unit": "passed",
    "build": "passed",
    "e2e": "not_run"
  },
  "knownIssues": [],
  "updatedAt": "..."
}

--------------------------------------------------
CHECKPOINT RULES
--------------------------------------------------

Update CODEX_HANDOFF.md and CODEX_STATE.json:

- after every meaningful milestone
- before starting a large refactor
- after a large refactor
- before running a long test suite
- after tests complete
- whenever a blocker is discovered
- whenever implementation direction changes
- approximately every 15-20 minutes during substantial work

Do NOT wait until the end of the project to update them.

If Git is already configured:

- use small logical commits where appropriate
- never rewrite user history
- never force push
- never discard unrelated user changes
- do not initialize a new repository if one is not already present

--------------------------------------------------
WHEN THE USER SAYS:
"continue from where you have left"
--------------------------------------------------

Do NOT ask what to do next.

Do NOT start again from Phase 1.

Do NOT repeat the complete repository audit.

Immediately:

1. Read docs/CODEX_HANDOFF.md.
2. Read docs/CODEX_STATE.json.
3. Inspect git status/diff if Git exists.
4. Inspect files named in "In Progress".
5. Read the last relevant test results.
6. Resume exactly from "Next Exact Task".
7. Continue implementation.
8. Update the checkpoint files again after the next milestone.

If the state file and actual code disagree, inspect the code and tests,
repair the state file, and continue from the actual repository state.

The repository must always be resumable even if a Codex session ends
without a final conversational message.

======================================================================
PRODUCT MISSION
======================================================================

AgentGuard is an always-on browser security and intelligence layer for
AI agents and browser automation.

The user should never need to manually scan a tab.

AgentGuard continuously answers:

1. Is any tab currently under browser automation?
2. Which tab?
3. Is control currently active, connected/idle, suspected, or ended?
4. What mechanism is being used?
5. What framework is being used?
6. Which actual agent/product is controlling it, if identifiable?
7. How strong is that attribution?
8. What evidence supports the conclusion?
9. What activity has occurred during the session?
10. What security policy applies?
11. Is a sensitive domain involved?
12. Are other browser tabs currently agent-controlled?
13. Should the user be alerted even when AgentGuard is unpinned?

Opening AgentGuard MUST NOT begin detection.

Opening AgentGuard displays intelligence already collected.

There must be:

- no Scan button
- no Rescan button
- no requirement to open AgentGuard
- no requirement to manually grant activeTab for ordinary monitoring
- no requirement to manually visit each tab
- no requirement for the agent to self-identify

======================================================================
COMPETITIVE BASELINE: AI BROWSER GUARD
======================================================================

Before implementing major changes, study the public implementation,
documentation, behavior, architecture and known limitations of:

AI Browser Guard
Chrome Web Store ID:
ojphpdmabflmcjhglfogmkdgchkncikf

Public repository:
opena2a-org/ai-browserguard

This is research for feature parity and technical learning.

DO NOT copy proprietary branding, visual assets or copyrighted UI.

DO NOT blindly copy implementation.

AgentGuard should independently implement stronger architecture.

Create:

docs/COMPETITOR_PARITY.md

The document must contain columns:

Feature
AI Browser Guard behavior
Current AgentGuard behavior
AgentGuard target behavior
Status
Tests

The competitor baseline includes at least:

- automatic agent takeover detection
- CDP debugger detection
- WebDriver detection
- behavioral analysis
- framework fingerprints
- V8 stack-trace signatures
- environment fingerprinting
- Playwright detection
- Puppeteer detection
- Selenium detection
- generic CDP/WebDriver detection
- Computer Use/cloud-environment detection
- emergency kill/contain capability
- keyboard emergency shortcut
- Read-Only delegation
- Limited delegation
- Full Access delegation
- time-bounded delegation
- domain allow/block rules
- boundary-violation alerts
- Allow Once workflow
- session timeline
- session history
- agent status/confidence display
- detection-method explanation
- local-first operation
- zero-network-by-default posture
- optional browser-layer network containment
- optional identity/trust intelligence
- optional site safety declarations
- extension notifications

AgentGuard does not need to reproduce questionable features merely for
parity.

For every competitor feature decide:

ADOPT
IMPROVE
REPLACE
DEFER
REJECT

and document why.

======================================================================
AGENTGUARD MUST EXCEED THE BASELINE
======================================================================

AgentGuard's differentiation is:

AUTOMATIC BROWSER-WIDE MONITORING
+
CROSS-TAB SECURITY ALERTS
+
SESSION LIFECYCLE INTELLIGENCE
+
MULTI-SIGNAL CORRELATION
+
TRANSPORT/FRAMEWORK/CONTROLLER SEPARATION
+
BACKGROUND-TAB ACTIVITY DETECTION
+
V8/RUNTIME FINGERPRINTING
+
ENVIRONMENT FINGERPRINTING
+
DEVTOOLS FALSE-POSITIVE HANDLING
+
CONSERVATIVE ATTRIBUTION
+
CONSERVATIVE ENFORCEMENT
+
ENTERPRISE POLICY
+
PRIVACY-SAFE AUDITING
+
PREMIUM UI/UX
+
EXCELLENT RECOVERY AFTER MV3 WORKER TERMINATION

======================================================================
DO NOT CLAIM "HUMAN"
======================================================================

Remove HUMAN as a factual control state.

An extension cannot prove that a person controls a tab merely because
automation was not detected.

Use:

type ControlState =
  | "AGENT_ACTIVE"
  | "AGENT_CONNECTED"
  | "AUTOMATION_LIKELY"
  | "AUTOMATION_SUSPECTED"
  | "NO_AUTOMATION_OBSERVED"
  | "UNMONITORED";

Definitions:

AGENT_ACTIVE
Strong correlated automation evidence plus recent automation-associated
activity.

AGENT_CONNECTED
Strong automation/control evidence persists but recent activity has
stopped.

AUTOMATION_LIKELY
Strong automation evidence without enough evidence for the strongest
control classification.

AUTOMATION_SUSPECTED
Weak/ambiguous evidence that has benign explanations.

NO_AUTOMATION_OBSERVED
Monitoring is available but no current positive automation evidence is
present.

UNMONITORED
AgentGuard lacks sufficient monitoring coverage.

Never display "Safe" solely because no signal was observed.

======================================================================
SEPARATE FOUR DIFFERENT QUESTIONS
======================================================================

Never collapse these concepts.

A. CONTROL

Is automation likely controlling/interacting with the tab?

B. TRANSPORT

Examples:

Chrome DevTools Protocol
WebDriver
in-page JavaScript automation
browser extension integration
OS/computer-use style control
unknown

C. FRAMEWORK

Examples:

Playwright
Puppeteer
Selenium
generic WebDriver
framework-like unknown

D. CONTROLLER / PRODUCT

Examples:

Claude
Claude Code
Codex
OpenAI browser tooling
another verified controller
unknown controller

A Playwright signal does NOT automatically mean Codex.

A CDP connection does NOT automatically mean Claude.

navigator.webdriver does NOT automatically mean AI.

======================================================================
ATTRIBUTION LEVEL
======================================================================

Use:

type AttributionLevel =
  | "VERIFIED"
  | "HIGH_CONFIDENCE"
  | "CORRELATED"
  | "FRAMEWORK_ONLY"
  | "UNATTRIBUTED";

Example:

Control evidence      95 / 100
Transport             CDP
Framework             Playwright-like
Framework confidence  91 / 100
Controller            Unknown
Controller confidence 0 / 100
Attribution           FRAMEWORK_ONLY

This is better than falsely showing:

"Codex detected".

======================================================================
AUTOMATIC ALL-TAB MONITORING
======================================================================

AgentGuard must continuously monitor accessible HTTP/HTTPS tabs.

Refactor away from an activeTab/manual-scan architecture.

Use the correct MV3 approach including, where justified:

- static content scripts
- document_start
- chrome.tabs lifecycle events
- chrome.webNavigation
- chrome.windows events
- chrome.debugger.getTargets()
- chrome.alarms
- chrome.storage.session
- chrome.storage.local
- chrome.storage.managed

When the extension starts:

- inventory existing tabs
- establish browser state
- establish active tab per window
- establish window focus
- initialize detectors
- reconcile stale sessions
- resume monitoring

When new tabs or navigation occurs:

monitor automatically.

======================================================================
EVENT-DRIVEN FIRST
======================================================================

Do NOT poll every tab every second.

Use:

FAST PATH

Triggered by meaningful events:

- navigation
- content-script connection
- automation fingerprint appearance
- WebDriver appearance
- unusual interaction
- background-tab interaction
- session state change
- tab/window focus transition

RECONCILIATION PATH

Obtain ONE browser-wide debugger target snapshot:

chrome.debugger.getTargets()

and correlate targets to tabs.

Do not call getTargets once per tab.

BACKGROUND SAFETY NET

Use an appropriate production-safe alarm cycle for reconciliation.

During an active suspicious session, temporary faster in-memory
observation may be used while the service worker is alive.

Back off when activity ends.

Do not intentionally keep the MV3 service worker alive forever.

======================================================================
DETECTION SENSOR CONTRACT
======================================================================

Build a modular detector architecture.

Conceptually:

interface DetectionEvidence {
  id: string;
  detector: DetectorId;
  family: SignalFamily;

  type: string;

  strength: number;

  reliability:
    | "strong"
    | "medium"
    | "weak";

  description: string;

  observedAt: number;
  expiresAt: number;

  metadata: SafeMetadata;
}

Every detector reports:

- AVAILABLE
- UNAVAILABLE
- DEGRADED
- ERROR

independently.

Failure of one detector must never disable the rest.

======================================================================
DETECTOR 1 — PASSIVE CDP / DEBUGGER INTELLIGENCE
======================================================================

Use chrome.debugger.getTargets().

Track:

- target ID
- target type
- tab ID
- URL/domain where safely available
- attached state
- first seen
- last seen
- attached transition
- detached transition
- target created
- target disappeared
- duration

Do NOT call every attached debugger:

"CDP Agent".

Preferred terminology:

Debugger attached
Unknown CDP controller

until stronger evidence exists.

Do not interfere with existing debugger sessions merely for detection.

======================================================================
DETECTOR 2 — V8 STACK TRACE FINGERPRINTING
======================================================================

This feature must reach parity with or exceed the competitor.

Research and implement safe, reproducible runtime call-stack markers.

Examples worth validating include signatures associated with:

Playwright:
UtilityScript.evaluate

Puppeteer:
pptr:evaluate

Selenium:
callFunction
executeScript

Do NOT blindly trust these strings.

Create reproducible fixtures and real-tool validation.

Store only the signature classification.

Do NOT persist full arbitrary page stack traces by default.

A stack marker identifies framework behavior, not necessarily the AI
product invoking that framework.

======================================================================
DETECTOR 3 — WEBDRIVER
======================================================================

Observe navigator.webdriver safely.

webdriver === true is meaningful automation evidence.

It does NOT identify an AI product.

Test:

- Selenium
- Playwright launches that expose webdriver
- Puppeteer configurations
- normal Chrome
- spoofed values

======================================================================
DETECTOR 4 — FRAMEWORK RUNTIME FINGERPRINTS
======================================================================

Maintain a versioned allowlisted fingerprint registry.

Research:

- Playwright
- Puppeteer
- Selenium
- generic WebDriver
- browser-use
- Stagehand
- agent-browser
- other major browser automation systems
- Codex browser tooling where observable
- Claude browser tooling where observable

Each fingerprint must contain:

id
framework
vendor
signal
reliability
version constraints
test fixture
false-positive notes
last verified date

No random anti-bot folklore.

======================================================================
DETECTOR 5 — ENVIRONMENT FINGERPRINTING
======================================================================

Add environment-level signals inspired by real browser-agent
environments.

Research signals such as:

- OS/platform
- software-rendered WebGL
- llvmpipe/Mesa
- screen geometry
- virtual display characteristics
- Xvfb-like environments
- browser/headless characteristics
- cloud/container combinations

IMPORTANT:

None of these alone proves AI automation.

For example Linux or software WebGL alone must never trigger a strong
agent classification.

Use environment evidence only as one family of corroborating evidence.

Create:

docs/ENVIRONMENT_FINGERPRINTS.md

Document:

- signal
- expected tools/environments
- false-positive risks
- test evidence
- strength

======================================================================
DETECTOR 6 — BACKGROUND TAB INTERACTION
======================================================================

This should be one of AgentGuard's major advantages.

Track privacy-safe interaction metadata:

- click count
- pointerdown count
- keyboard interaction count
- beforeinput/input count
- submit count
- scroll count
- focus changes

NEVER collect:

- actual keyboard characters
- text typed
- form values
- passwords
- selectors by default
- page text
- exact mouse coordinates

Correlate interaction with:

document.visibilityState

current active Chrome tab

focused browser window

debugger state

WebDriver

framework markers

Examples:

trusted interaction while tab is inactive

trusted interaction while document is hidden

background interaction while CDP is attached

background interaction during Playwright-like session

These may be strong evidence after validation.

======================================================================
DETECTOR 7 — SYNTHETIC EVENTS
======================================================================

Observe Event.isTrusted where useful.

Repeated synthetic interaction can support an automation hypothesis.

Synthetic events alone must not result in high-confidence detection.

Normal websites dispatch synthetic events.

======================================================================
DETECTOR 8 — BEHAVIORAL ANALYSIS
======================================================================

Analyze privacy-safe aggregate behavior:

- burst size
- inter-event timing
- typing cadence
- unusually regular timing
- extremely fast action chains
- navigation-to-action latency
- repetitive sequences
- precision/repetition patterns

Behavior alone must not identify a specific agent.

======================================================================
DETECTOR 9 — NAVIGATION CORRELATION
======================================================================

Track privacy-safe navigation metadata.

Store domain by default, not complete URLs.

Correlate navigation with:

- session state
- debugger attachment
- automation markers
- background activity
- focus state

======================================================================
DETECTOR 10 — COMPUTER-USE / OS-LEVEL ENVIRONMENT
======================================================================

Create a separate detector family for computer-use/cloud-browser style
environments.

Research observable signals for environments commonly associated with:

- Anthropic Computer Use
- cloud browser agents
- remote virtual-browser infrastructure

Use:

environment-like
computer-use-like

unless independently verified.

Do not claim:

Anthropic detected

solely because Linux + Xvfb + llvmpipe exists.

======================================================================
DEVTOOLS FALSE-POSITIVE LAB
======================================================================

Normal DevTools can produce debugger-related evidence.

Build a controlled Detection Lab with scenarios:

NORMAL CHROME

DEVTOOLS OPEN

PLAYWRIGHT

PUPPETEER

SELENIUM

CODEX

CLAUDE / CLAUDE CODE

OTHER AVAILABLE AGENT TOOLS

Compare observable evidence.

If a difference cannot be reproduced reliably, do not promote it to a
production fingerprint.

Debugger-only evidence should normally remain:

AUTOMATION_SUSPECTED

unless corroborated.

======================================================================
AGENT ATTRIBUTION ENGINE
======================================================================

Create:

interface AgentIdentity {
  displayName: string | null;
  vendor: string | null;
  product: string | null;
  version: string | null;

  attributionLevel: AttributionLevel;

  confidence: number;

  evidenceIds: string[];
}

and:

interface AutomationStack {
  transports: string[];
  frameworks: string[];
  environmentHints: string[];
  controllerCandidates: AgentIdentity[];
}

The UI should support:

Controller
Unknown

Transport
Chrome DevTools Protocol

Framework
Playwright-like

Environment
Cloud-browser-like

Attribution
Framework only

======================================================================
VERIFIED ATTRIBUTION PROTOCOL
======================================================================

Heuristics alone will never perfectly identify every controller.

Therefore design an AgentGuard Attribution Protocol for cooperating
agents/extensions.

A trusted cooperating controller can declare:

vendor
product
version
session ID
controlled tab ID
capabilities
timestamp

But validate the sender.

Do not trust arbitrary page JavaScript claiming:

"I am Codex"

or:

"I am Claude".

Support enterprise-configured trusted controller identities.

This allows future VERIFIED attribution.

======================================================================
CONTROL SCORE != IDENTITY SCORE
======================================================================

Maintain separately:

CONTROL EVIDENCE SCORE

FRAMEWORK CONFIDENCE

CONTROLLER IDENTITY CONFIDENCE

COVERAGE SCORE

Example:

Control evidence      96
Framework             Playwright-like
Framework confidence  93
Controller            Unknown
Identity confidence   0
Coverage               6/7

======================================================================
CORRELATION ENGINE
======================================================================

Avoid naive score addition.

Group evidence into independent families such as:

browser-control
runtime-stack
runtime-environment
interaction
navigation
identity
trusted-integration

Cap correlated families.

Examples:

Debugger only:
AUTOMATION_SUSPECTED

Debugger + WebDriver:
AUTOMATION_LIKELY

Debugger + trusted interaction in inactive tab:
very strong control evidence

Debugger + V8 Playwright marker + inactive-tab interaction:
strong framework/control evidence

Verified attribution handshake + active control:
VERIFIED controller

======================================================================
AGENT SESSION ENGINE
======================================================================

Create first-class AgentSession objects.

interface AgentSession {
  id: string;

  tabId: number;

  domain: string | null;

  controlState: ControlState;

  controller: AgentIdentity;

  automationStack: AutomationStack;

  controlScore: number;

  coverageScore: number;

  startedAt: number;

  lastActivityAt: number;

  endedAt: number | null;

  active: boolean;

  evidenceIds: string[];

  observedActivity: {
    navigations: number;
    pointerInteractions: number;
    keyboardInteractions: number;
    inputInteractions: number;
    scrolls: number;
    submits: number;
    syntheticInteractions: number;
  };
}

Do NOT call these:

"Agent actions"

unless actual attribution exists.

Use:

"Observed activity during automation session".

======================================================================
ACTIVE VS CONNECTED
======================================================================

A useful product must distinguish:

ACTIVE NOW

from:

CONNECTED / IDLE

Example:

Agent active
Last activity 2 sec ago

versus:

Automation connected
Last activity 1 min 23 sec ago

Then:

Session ended 20:31:19

Use evidence expiry and activity windows.

======================================================================
BROWSER-WIDE INTELLIGENCE
======================================================================

The popup must not only inspect the selected/current tab.

Header example:

AgentGuard

2 ACTIVE
1 CONNECTED
1 SUSPICIOUS

Display browser-wide sessions sorted by severity.

Then show current-tab details separately.

======================================================================
MANDATORY CROSS-TAB ALERT
======================================================================

Scenario:

The user is working in Tab 4.

Automation begins controlling Tab 1.

AgentGuard is NOT pinned.

The user must still receive a small AgentGuard alert in the top-right of
Tab 4.

Detection requires zero user interaction.

Implement:

Shadow DOM isolated alert UI

approximately 320-380 px wide

trusted data sent only by extension service worker

example:

┌────────────────────────────────────┐
│ AgentGuard                         │
│ Automation detected               │
│                                    │
│ admin.example.com                  │
│ Unknown controller                │
│ CDP · Playwright-like              │
│ Active now                         │
│                                    │
│ [Review]                [Dismiss]  │
└────────────────────────────────────┘

Review must activate/open the affected tab or security details.

======================================================================
SYSTEM NOTIFICATION FALLBACK
======================================================================

Use chrome.notifications for cases where:

- active tab cannot receive content scripts
- chrome:// page
- Chrome Web Store
- another extension page
- injection fails
- enterprise policy demands persistent alert
- detection severity is critical

System notification example:

AgentGuard
Automation detected in another tab

admin.example.com
Unknown CDP controller · Playwright-like

Actions where supported:

Review
Contain

Do not spam.

======================================================================
ALERT COORDINATOR
======================================================================

Alert primarily on transitions:

NO_AUTOMATION_OBSERVED -> AUTOMATION_LIKELY

AUTOMATION_LIKELY -> AGENT_ACTIVE

unknown -> verified controller

new sensitive-domain automation

policy escalation

Do not alert on every scan.

Implement:

- per-session deduplication
- cooldown
- aggregation
- escalation
- dismissal state
- queueing

Five simultaneous detections should produce:

"5 automated tabs detected"

not five overlays.

======================================================================
COMPETITOR PARITY: EMERGENCY CONTROL
======================================================================

Implement an emergency protection capability comparable to or better
than AI Browser Guard.

Provide a keyboard shortcut such as:

Ctrl+Shift+K
Cmd+Shift+K

but use accurate terminology.

A Chrome extension usually cannot terminate the external agent process.

Therefore actions should include:

CONTAIN TAB

CLOSE CONTROLLED TAB

REVOKE DELEGATION

STOP IN-PAGE AUTOMATION

CLOSE ALL CURRENTLY CONTROLLED TABS

Do not claim:

"Kill Codex process"

or:

"Stop Claude globally"

unless technically true.

The shortcut behavior must be documented.

======================================================================
COMPETITOR PARITY: DELEGATION
======================================================================

Add an Agent Delegation system.

Presets:

READ ONLY

LIMITED

FULL ACCESS

CUSTOM

READ ONLY:

allow navigation/read-like delegated behavior where enforceable

deny mutation/click/type/form submission where enforceable

LIMITED:

specific domains/capabilities

time limited

FULL ACCESS:

broad delegated interaction

logging still enabled

CUSTOM:

user/enterprise policy chooses capabilities

Support durations such as:

15 minutes
1 hour
4 hours
until revoked

Support:

allowlist
blocklist
wildcard/glob-like domain patterns where implemented safely

Display clearly whether a rule is:

ENFORCED

BEST-EFFORT

INTENT ONLY

External CDP automation may bypass in-page delegation enforcement.

Never pretend otherwise.

======================================================================
BOUNDARY VIOLATION ALERTS
======================================================================

For actions AgentGuard can legitimately attribute and intercept:

detect attempts outside delegation.

Examples:

scripted navigation
form submission
synthetic click
synthetic keystroke
window open
download where attribution is reliable
network operation where enforceable

Show:

what happened
domain
policy
why it was denied

Provide:

Allow Once

ONLY when implementation can actually guarantee that this button
modifies the correct session/rule.

Never create an inert button.

======================================================================
CRITICAL IMPROVEMENT OVER COMPETITOR:
NEVER ENFORCE ON UNCERTAIN ATTRIBUTION
======================================================================

This is mandatory.

An observable browser event may lack enough information to associate it
with an automation session.

In that situation:

LOG
+
WARN IF APPROPRIATE
+
DO NOT BLOCK

unless enterprise policy explicitly chooses coarse browser-wide
blocking independent of attribution.

Examples include downloads.

If Chrome does not expose enough information to reliably determine
which tab/session originated a download:

DO NOT guess.

Do not say:

"there is one agent somewhere, therefore this download belongs to it".

Create:

type AttributionResult =
  | { state: "CERTAIN"; sessionId: string }
  | { state: "PROBABLE"; sessionId: string; confidence: number }
  | { state: "UNKNOWN" };

Default enforcement rule:

CERTAIN:
may enforce

PROBABLE:
warn/log unless explicit enterprise policy allows enforcement

UNKNOWN:
never agent-specific block

This prevents human activity in Tab 4 from being blocked because an
agent happens to exist in Tab 1.

Add regression tests specifically for this scenario.

======================================================================
ALLOW ONCE / RULE CHANGES MUST BE REAL
======================================================================

Every UI control must have end-to-end validation.

If user clicks:

Allow Once

verify:

1. the correct session is identified
2. the correct rule changes
3. the UI reflects it
4. the next eligible action is allowed
5. the one-time grant expires correctly

Never return:

{ success: true }

when nothing was changed.

Implement explicit success/failure responses with reason codes.

======================================================================
SESSION TIMELINE
======================================================================

Create a high-quality timeline.

Example:

20:28:19
Debugger attachment observed

20:28:20
Playwright-like V8 signature observed

20:28:21
Background interaction observed

20:28:24
Navigation

20:28:26
Automation state → ACTIVE

20:29:04
Last observed activity

20:29:35
State → CONNECTED

20:31:19
Session ended

Timeline should distinguish:

OBSERVED

INFERRED

VERIFIED

ALLOWED

BLOCKED

CONTAINED

======================================================================
SESSION HISTORY
======================================================================

Do better than an arbitrary last-five-session-only design.

Use bounded configurable local retention.

Possible default:

50 recent sessions
or
7 days

whichever reaches limit first.

Enterprise managed policy may change retention.

Storage must remain bounded.

Provide:

Clear history
Export sanitized report

======================================================================
BROWSER-LAYER NETWORK CONTAINMENT
======================================================================

Research and implement safe browser-layer enforcement where appropriate.

Potential mechanisms:

chrome.debugger + CDP Fetch

and/or

declarativeNetRequest

depending on threat model.

IMPORTANT:

CDP network interception sees requests, but does not inherently prove
whether human or agent initiated each request.

Therefore do not market generic tab-level network blocking as
per-agent request attribution.

Use browser-layer containment for:

explicitly blocked destinations

on explicitly delegated/contained tabs

or enterprise coarse policies.

Label it accurately.

If WebSocket cannot be covered by a particular mechanism, document it.

If another mechanism can safely cover it, test it.

======================================================================
PAGE-REALM INTERCEPTOR
======================================================================

For in-page automation, investigate safe interception of:

window.open
form submission
history/navigation
scripted clicks
scripted typing
fetch
XHR
EventSource
workers
resource loads where relevant

Assume hostile page code can re-patch MAIN-world functions.

Therefore classify page-layer enforcement as:

BEST-EFFORT

unless a lower browser-level enforcement mechanism guarantees it.

======================================================================
OPTIONAL SITE SAFETY DECLARATIONS
======================================================================

Research support for:

/.well-known/ai-safety.txt

If implemented:

OFF BY DEFAULT

HTTPS only

no cookies

no referrer

no redirects

cache locally with bounded lifetime

display as:

"Site-declared information"

NEVER use a site's self-asserted declaration to change detection
confidence automatically.

This feature is secondary.

Do not prioritize it ahead of detection quality.

======================================================================
OPTIONAL AGENT TRUST INTELLIGENCE
======================================================================

Architect an optional provider interface:

AgentTrustProvider

but do NOT hardwire AgentGuard to another company's API.

Potential future features:

agent identity registry
enterprise-approved agent registry
trust metadata
revocation status
known vendor signatures

Default extension behavior:

zero external requests.

Any future lookup:

explicit opt-in
minimal metadata
never page content
never credentials
never full browsing history

======================================================================
PRIVACY BY DEFAULT
======================================================================

By default AgentGuard makes ZERO external network requests of its own.

Do not add:

analytics
telemetry
tracking
advertising SDKs
remote executable code

Do NOT collect or persist:

page contents
DOM text
passwords
form values
actual keyboard characters
cookies
authentication tokens
request bodies
response bodies
screenshots
clipboard data

Persist domain instead of full URL by default.

If temporary full URLs are needed to operate on a tab, keep them
ephemeral and do not place them in persistent audit history.

======================================================================
OPTIONAL COMMUNITY INTELLIGENCE
======================================================================

Do NOT implement automatic upload in the first production iteration.

Instead create a future provider boundary.

If later implemented, it must be:

off by default
explicit opt-in
fully documented
anonymized
revocable
minimal

Enterprise deployments must be able to disable it by policy.

======================================================================
PREMIUM POPUP REDESIGN
======================================================================

Do NOT clone AI Browser Guard's visual design.

Build an original high-end enterprise security interface.

The popup should show:

HEADER

AgentGuard
global browser automation state
active count
connected count
settings

LIVE SESSIONS

domain
controller
framework
transport
state
control score
identity quality
last activity

CURRENT TAB

control status
session duration
controller
framework
transport
environment hints

WHY AGENTGUARD THINKS THIS

strongest evidence cards first

AUTOMATION STACK

Controller
Transport
Framework
Environment
WebDriver
Attribution

POLICY

delegation
enforcement mode
sensitive-domain state

TIMELINE

compact recent activity

COVERAGE

available/unavailable detectors

EMERGENCY ACTIONS

Review
Contain tab
Close controlled tab
Revoke delegation

======================================================================
SECURITY CENTER
======================================================================

Turn options/settings into a complete AgentGuard Security Center.

Sections:

LIVE

browser-wide active automation

HISTORY

past automation sessions

DELEGATION

Read Only / Limited / Full / Custom

POLICIES

sensitive-domain rules

DETECTORS

health and evidence sources

ATTRIBUTION

recognized frameworks/controllers

ALERTS

overlay/system notification behavior

PRIVACY

what AgentGuard observes and stores

ENTERPRISE

managed settings

DIAGNOSTICS

safe troubleshooting data

DETECTION LAB

developer-only fingerprint diagnostics

======================================================================
UI QUALITY
======================================================================

The UI should look like a serious premium endpoint-security product.

Requirements:

- clear typography
- compact density
- excellent spacing
- strong information hierarchy
- original components
- accessible colors
- semantic severity states
- clear iconography
- keyboard accessibility
- screen-reader labels
- reduced-motion support
- no horizontal scroll
- no giant unnecessary gradients
- no childish hacker aesthetic
- no fake certainty
- no overwhelming raw technical data by default

Provide expandable technical detail for advanced users.

======================================================================
ENTERPRISE
======================================================================

Same extension.

Use chrome.storage.managed where appropriate.

Enterprise policy may define:

monitoring enabled
alert threshold
sensitive domains
delegation defaults
blocked domains
containment behavior
retention
detector configuration
verified controller identities
notification rules

Managed configuration overrides local configuration.

Clearly mark:

Managed by your organization

in UI.

======================================================================
RESTRICTED PAGES
======================================================================

Handle:

chrome://
Chrome Web Store
extension pages
other restricted contexts

correctly.

Use:

UNMONITORED

"Chrome restricts AgentGuard from observing this page."

Do not interpret lack of access as absence of automation.

======================================================================
HOSTILE PAGE MODEL
======================================================================

Assume the webpage may attempt to spoof AgentGuard.

Therefore:

validate sender context

validate every message schema

use bounded payloads

never trust page-declared controller identity

never render arbitrary HTML

use Shadow DOM alert host

sanitize all strings

use extension-generated session IDs

maintain strict CSP

keep trusted state in extension contexts

======================================================================
MV3 SERVICE WORKER RESILIENCE
======================================================================

Assume the service worker may terminate at any moment.

Critical recoverable state must use:

chrome.storage.session
chrome.storage.local
browser APIs
content-script reconnect

Do not depend on module globals surviving.

Test:

worker death
worker restart
tabs remaining open
active automation continuing

Sessions should reconstruct as accurately as possible.

======================================================================
PERFORMANCE
======================================================================

AgentGuard must remain lightweight with many tabs.

Never:

scan entire DOM repeatedly
serialize page HTML
poll all tabs every second
create one debugger snapshot per tab
store unbounded events
install duplicate content listeners
create runaway timers

Use:

event listeners
bounded buffers
TTL evidence
single browser target snapshots
debouncing
batching
session cleanup
concurrency limits

Create tests for:

10 tabs
50 tabs
100 synthetic tab/session states

Verify no O(tabs²) monitoring loop.

======================================================================
DETECTION LAB
======================================================================

Create a developer-only detection lab.

It should generate sanitized evidence snapshots.

Test:

normal Chrome
DevTools
Playwright
Puppeteer
Selenium
WebDriver
Codex browser interaction
Claude browser interaction
computer-use/cloud environment
synthetic automation
background automation
multiple simultaneous controlled tabs

For every tool record:

detected?
control score?
transport?
framework?
controller?
identity level?
false positives?
missed behavior?
Chrome version?
tool version?

Create:

docs/AGENT_TEST_MATRIX.md

Mark unavailable tools:

MANUAL TEST REQUIRED

Never fake a passing result.

======================================================================
COMPETITOR REGRESSION TESTS
======================================================================

Add explicit tests designed around weaknesses found in competing
approaches.

At minimum:

TEST 1

Agent active in Tab 1.

Human initiates unrelated action/download in Tab 4.

AgentGuard must NOT attribute Tab 4 activity to Tab 1 merely because
only one automation session exists.

TEST 2

UI "Allow Once" action.

Verify actual policy mutation.

Verify action becomes allowed.

Verify one-time permission expires.

TEST 3

Debugger open in a normal human-development workflow.

Must not automatically produce verified AI-agent identity.

TEST 4

External CDP session.

Per-action page-realm logging may be incomplete.

UI must explain monitoring limitations.

TEST 5

External controller remains alive after controlled tab closes.

UI must never claim external process termination.

======================================================================
MULTI-TAB ACCEPTANCE TEST
======================================================================

Mandatory scenario:

Tab 1
automation controlled

Tab 2
normal

Tab 3
normal

Tab 4
user currently active

AgentGuard unpinned.

Automation starts in Tab 1.

AgentGuard must:

1. detect it automatically
2. create a session
3. correlate evidence
4. update browser-wide status
5. show a top-right alert in Tab 4
6. work while unpinned
7. avoid modifying Tab 4 data
8. offer Review
9. bring user to Tab 1/session details when requested
10. alert only once for the same state transition
11. continue monitoring after worker restart

======================================================================
MULTIPLE AUTOMATION SESSIONS
======================================================================

Support simultaneously:

Tab 1
Playwright-like
ACTIVE

Tab 3
Selenium/WebDriver
CONNECTED

Tab 7
Debugger attached
AUTOMATION_SUSPECTED

Global UI:

1 active automation
1 connected automation
1 suspicious debugger session

Never collapse different tabs into a single generic "Agent detected".

======================================================================
AUDIT
======================================================================

Audit events may include:

session_started
session_active
session_connected
session_ended
identity_updated
debugger_attached
debugger_detached
webdriver_detected
stack_signature_detected
environment_signal_detected
background_interaction
navigation_observed
policy_triggered
boundary_violation
allow_once_granted
containment_requested
containment_failed
alert_shown
coverage_changed

Use a bounded store.

No hidden upload.

======================================================================
PERMISSION REVIEW
======================================================================

Re-evaluate manifest permissions from first principles.

Continuous monitoring may require some combination of:

storage
scripting
alarms
debugger
notifications
webNavigation
commands
HTTP/HTTPS host permissions

Only add permissions that are actually required.

Review whether activeTab remains necessary.

Do not add management merely for impressive-looking agent detection.

Research management permission separately before adding it.

Create/update:

docs/PERMISSIONS.md

For every permission document:

why needed
what data it exposes
Chrome warning
whether required
whether alternative exists

======================================================================
CHROME WEB STORE READINESS
======================================================================

Design for Chrome Web Store review.

Avoid:

remote executable code
unnecessary broad permissions
misleading claims
hidden telemetry
unexplained site access
fake security guarantees

Document why:

all-site monitoring

debugger access

notifications

are core to AgentGuard's user-facing purpose.

======================================================================
TESTING
======================================================================

Do not call this complete until all applicable commands pass:

npm run typecheck

npm test

npm run build

npm run test:e2e

npm run package

Do not:

skip broken tests
remove difficult tests
weaken expectations
hardcode test-only production behavior

======================================================================
REQUIRED TEST AREAS
======================================================================

Cover:

startup detection

existing tabs at extension start

navigation

SPA navigation

tab creation/removal

window focus

current tab changes

debugger target transition

WebDriver

V8 fingerprints

environment fingerprints

behavioral detector

background-tab activity

synthetic event detector

session creation

ACTIVE -> CONNECTED transition

session ending

evidence expiry

framework attribution

controller attribution

DevTools false positive

cross-tab alert

alert deduplication

system-notification fallback

delegation

Allow Once

boundary violation

uncertain attribution

download attribution

sensitive-domain policy

containment

restricted pages

worker termination

browser restart

managed policy

storage corruption

permission removal

multiple agent tabs

performance

privacy redaction

======================================================================
DOCUMENTATION
======================================================================

Update/create:

README.md

ARCHITECTURE.md

SECURITY.md

docs/CODEX_HANDOFF.md

docs/CODEX_STATE.json

docs/COMPETITOR_PARITY.md

docs/PERMISSIONS.md

docs/DETECTION_MODEL.md

docs/ENVIRONMENT_FINGERPRINTS.md

docs/AGENT_TEST_MATRIX.md

docs/THREAT_MODEL.md

docs/PRIVACY.md

docs/IMPLEMENTATION_PLAN.md

docs/ACCEPTANCE.md

Documentation must describe implemented reality.

Do not document planned functionality as completed.

======================================================================
IMPLEMENTATION PHASES
======================================================================

PHASE 0
Create continuity/checkpoint system.

PHASE 1
Audit existing AgentGuard repository and competitor feature parity.

PHASE 2
Redesign shared state/contracts.

PHASE 3
Convert to automatic browser-wide monitoring.

PHASE 4
Build session engine.

PHASE 5
Upgrade CDP/debugger intelligence.

PHASE 6
Implement WebDriver + runtime fingerprints.

PHASE 7
Implement V8 stack-trace fingerprinting.

PHASE 8
Implement environment/computer-use fingerprints.

PHASE 9
Implement interaction/focus/background correlation.

PHASE 10
Build new correlation/scoring engine.

PHASE 11
Build framework and controller attribution.

PHASE 12
Implement browser-wide popup intelligence.

PHASE 13
Implement cross-tab overlay + system notification fallback.

PHASE 14
Implement delegation and boundary policies.

PHASE 15
Implement emergency controls.

PHASE 16
Implement timeline/history/security center.

PHASE 17
Enterprise managed policies.

PHASE 18
Privacy/security hardening.

PHASE 19
Real-tool Detection Lab and test matrix.

PHASE 20
Full automated testing/performance testing.

PHASE 21
Chrome Web Store readiness and packaging.

Each phase must update the handoff state.

Do not wait for user approval between normal implementation phases
unless a genuine product decision or dangerous/destructive operation
requires it.

======================================================================
DO NOT STOP AFTER PLANNING
======================================================================

After repository audit and migration plan:

continue implementing.

Do not return only architecture prose.

Modify the repository.

Test the code.

Fix failures.

Continue phase-by-phase.

If the Codex usage window ends, the latest
docs/CODEX_HANDOFF.md and docs/CODEX_STATE.json
must be sufficient for another session to continue immediately.

======================================================================
IF A REQUIREMENT IS IMPOSSIBLE
======================================================================

Do not fake it.

Instead:

1. identify the Chrome/platform limitation
2. explain exactly what is unavailable
3. implement the strongest technically valid alternative
4. test that alternative
5. document it
6. surface the limitation accurately in UI

======================================================================
FINAL DEFINITION OF DONE
======================================================================

The final experience should be:

I install one AgentGuard extension.

I do not pin it.

I never click Scan.

I browse normally.

An AI/browser agent begins operating a tab.

AgentGuard automatically observes it.

It combines debugger, runtime, stack, environment, behavioral,
interaction and focus evidence where available.

It identifies the transport.

It identifies the framework when evidence supports it.

It identifies the exact controller only when evidence supports it.

It creates a persistent recoverable automation session.

It knows whether the session is active, connected, suspicious, or
ended.

It shows browser-wide agent activity.

If I am on another tab, it alerts me automatically.

It gives me Review, delegation and containment controls.

It provides Read Only, Limited, Full and Custom delegation where
technically enforceable.

It warns on boundary violations.

It never blocks my unrelated human action merely because another tab
contains an agent.

It logs privacy-safe session activity.

Enterprise policy can centrally configure it.

It survives MV3 service-worker termination.

It clearly explains every detection.

It never claims missing evidence means I am safe.

It never claims a framework means a specific AI product without
evidence.

It never claims a closed tab means the external AI process was killed.

The product feels like professional enterprise endpoint-security
software, not a proof-of-concept browser extension.

======================================================================
FINAL REPORT
======================================================================

When implementation eventually finishes, report:

Architecture changes

Competitor parity status

Features where AgentGuard exceeds competitor behavior

Automatic monitoring architecture

Complete detector list

Framework attribution approach

Controller attribution approach

V8 fingerprint results

Environment fingerprint results

DevTools false-positive behavior

Cross-tab alert implementation

Delegation implementation

Boundary enforcement limitations

Emergency controls

Final permissions

Privacy guarantees

UI changes

Enterprise behavior

Files added/changed/removed

Unit test results

Browser test results

Performance results

Actual tools tested

Manual tests remaining

Known platform limitations

Final dist/ path

Final packaged ZIP path

Finally answer explicitly:

Can AgentGuard identify the exact AI agent controlling every browser
tab?

The answer must be technically truthful based on the final
implementation, not marketing language.
