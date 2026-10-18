# Optional service contracts

All clients are disabled by default and manual-only. Configure an approved HTTPS service in External services or managed policy; there is no built-in public endpoint, authentication secret, organization enrollment or deployed backend. No requests occur on installation, ordinary detection or opening settings. Server compatibility and authorization remain deployment checks.

Endpoints must use HTTPS, no embedded credentials, query, fragment or non-443 port. Literal IPs, localhost and reserved local/test names are rejected. DNS names can still resolve internally: administrators must approve the endpoint and its DNS behavior. No redirects, cookies, authorization headers, referrers or page data are sent. Fetch has a five-second timeout, strict response media type and a streaming 16 KiB cap. The receiving server still sees source IP/network metadata; contributions are not guaranteed anonymous.

## Framework lookups

Only fixed names `playwright`, `puppeteer`, `selenium`, `webdriver` derived from existing evidence are sent. AIM protocol uses `GET <base>/api/v1/agents/<name>` and accepts a finite `trustScore` in [0,1]. Registry protocol uses `GET <base>/api/v1/registry/search?q=<name>` and accepts a single exact-name result with integer `trustLevel` in [0,4]. Registry responses must be arrays of at most 100 results; ambiguous/malformed matches are unavailable. Other returned names, URLs and properties are discarded, never displayed as controller identity. HTTP 404 means not listed, not unsafe. Failure means unavailable, never zero trust. Successful/type-level results cache for five minutes in memory. These adapters do not verify a running controller and never change policy or detection scores.

## Site declarations

A manually selected current Chrome tab supplies the origin; UI cannot supply arbitrary target URLs. Only HTTPS `/.well-known/ai-safety.txt` is fetched, without upgrading an HTTP tab. The parser supports the three boolean claims `AI-Safe`, `Injection-Protected`, `Consistent-Rendering`, with case-insensitive names, exact lowercase boolean values and first-occurrence semantics (including invalid first values). Other fields, including contacts/attestation URLs, are discarded and not followed. At most 100 origins/claims are cached for 24 hours in memory; nothing is persisted. Missing/unusable declarations and transport failure are distinct. Claims never prove safety or relax policy. This is a deliberately limited display-only reader for a [work-in-progress draft](https://www.ietf.org/archive/id/draft-fane-ai-safety-txt-00.html), not a safety certification.

## Aggregate contribution

The user enables a configured endpoint and confirms each POST. Payload:

```json
{"schemaVersion":1,"sessionsObserved":2,"confirmedContainments":1,"frameworkCounts":{"Playwright-like":2,"Puppeteer-like":0,"Selenium-like":0,"WebDriver-compatible":0}}
```

Counts cap at 1,000,000,000. No hostnames, URLs, session/tab/installation IDs, timestamps, raw evidence, inputs or credentials. The exact configured endpoint must return successful `application/json` with `{"received":true}`; 404, malformed/oversized bodies and missing receipts are not claimed successful. One in-flight contribution and a one-minute current-worker cooldown; no scheduled retries/queue. This receipt protocol is AgentGuard's own contract, not a claim that a public contribution server implements it.
