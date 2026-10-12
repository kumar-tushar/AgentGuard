# Runtime fingerprint registry

The packaged registry is `src/shared/fingerprints.ts`, version 1. It drives the serialized MAIN-world probe arguments, hostile-output validator, evidence weights/descriptions and framework hints in tab/session views. There are no remote updates or vendor identity lookups. Static maintainer metadata describes the framework project, never the controller operating a tab. It is not copied into observed identity or exports.

Only existence of seven fixed own-property names is checked. Values, getters, arbitrary property lists, DOM content and source strings are not read. Multiple aliases produce one evidence ID. All four existing weights and IDs are retained; the newer Playwright controller property is an additional alias for the existing binding ID. Markers share the runtime family with WebDriver, so aliases and repeated observations cannot inflate the family score.

| Evidence ID | Fixed properties | Weight | Verification and limits |
| --- | --- | --- | --- |
| playwright-binding | `__playwright__binding__`, `__playwright__binding__controller__` | .34 | Installed Playwright 1.63.0 source inspected; genuine `page.exposeBinding` browser fixture. Presence depends on binding configuration, not every Playwright connection. |
| playwright-init | `__pwInitScripts` | .28 | Legacy compatibility marker, synthetic fixture only; no verified supported-version range. |
| selenium-global | `__selenium_unwrapped`, `__selenium_evaluate` | .28 | Legacy compatibility markers, synthetic fixtures only; not verified against an actual Selenium launch. |
| webdriver-global | `__webdriver_evaluate`, `__webdriver_script_fn` | .25 | Legacy compatibility markers, synthetic fixtures only; not standard WebDriver properties or verified protocol identity. |

The registry records a nullable last-verified date, fixture, version limitations and false-positive notes for each definition. Null means unverified, not implicitly current. The legacy records preserve existing behavior while provenance research continues; they are not newly validated signatures. Any page can forge these properties, and ordinary authorized testing can produce them. They support weak framework hints, never named AI controllers or AGENT_ACTIVE/AGENT_CONNECTED states.

## Standard flag and failure semantics

`navigator.webdriver === true` remains strong automation evidence (.82), not AI-product identity. False does not establish human control; absent, nonboolean and throwing values are unknown. Marker-inspection failure produces `fingerprints: null`, distinct from a successfully checked empty array. The WebDriver detector can still use its independent flag. Without positive evidence, NO_AUTOMATION_OBSERVED requires successful WebDriver, fingerprint and debugger coverage; otherwise the state is UNMONITORED. Stored negative assessments are checked against the same coverage rule when restored.

## Validation and research status

Unit fixtures cover each fixed property with a throwing getter, inherited/lookalike names, alias deduplication, serialized execution without module closures, marker-inspection failure, malformed flags and provenance lookups. Synthetic fixtures verify AgentGuard's handling of a marker, not that a framework actually emits it. The real Playwright browser scenario uses `exposeBinding`, checks the actual marker properties, waits for automatic extension detection and verifies framework-only session attribution. It separately hides WebDriver to ensure weak markers are not promoted to named/active agent control.

Real Selenium/Puppeteer launches and normal headed Chrome remain pending. Puppeteer stack signatures belong to the later stack module, not an invented global marker. No unique runtime signatures for browser-use, Stagehand, agent-browser, Codex or Claude are currently validated here. Their absence from this registry is a coverage limitation, not evidence that those tools are absent. Phase 6 remains in progress until the broader primary-source research and required tool matrix are complete.

Primary sources inspected on 2026-09-26:

- [Playwright page binding implementation](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/page.ts) and installed `playwright-core` 1.63.0 source establish the binding names and configuration dependence; the actual installed release is covered by the browser fixture.
- [Playwright controller property definition](https://github.com/microsoft/playwright/blob/main/packages/isomorphic/utilityScriptSerializers.ts) supplies the controller-property alias. These are framework implementation details, not authenticated identity.
- [W3C WebDriver interface](https://www.w3.org/TR/webdriver/#interface) defines the standard flag; it does not define the legacy Selenium/WebDriver globals above.
- [Selenium injection implementation](https://github.com/SeleniumHQ/selenium/blob/trunk/javascript/atoms/inject.js) was inspected as a starting point; it does not establish provenance or current validity of the retained legacy marker names. Further research is required.
