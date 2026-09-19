# Permissions and coverage

| Permission | Consent | Reason |
| --- | --- | --- |
| storage | Required | Session tab/automation state, local bounded audit/history/configuration and enterprise managed settings. Access restricted to trusted contexts. |
| scripting | Required | Run small top-frame runtime/aggregate probes and backfill the isolated sensor on accessible sites. |
| webNavigation | Required | Receive same-document navigation events and verify sensor messages against Chrome's current top-frame document ID. No browsing history API or URL persistence. |
| alarms | Required | Refresh evidence and retention after MV3 worker suspension; one-minute interval. |
| http://*/*, https://*/* | Required host permissions | Automatic document-start monitoring across accessible web tabs without any popup/Scan/activeTab prerequisite. Chrome site-access controls and enterprise restrictions still apply. |
| declarativeNetRequestWithHostAccess | Optional API permission | Adds network request blocking for quarantined tabs on granted hosts; never pretends to grant all-site protection. |
| debugger | Required at installation | Calls getTargets to observe attachment indicators without attaching or sending CDP commands. Powerful permission; Chrome does not allow it in optional_permissions. |

These permissions belong to one manifest used by every deployment. Managed settings change behavior, not the build or its permission declarations.

`tabs` is intentionally absent: tab IDs and lifecycle operations need no permission; URL properties are visible through effective host access. `activeTab` is absent because monitoring is automatic. No cookies, webRequest, history, management, downloads, notifications, nativeMessaging or remote endpoint access. User exports use an in-memory download link. Notifications are a planned later phase, not a current permission.

Optional DNR permission requests happen directly inside a UI gesture, not after background messaging. Withheld site access is shown as reduced coverage. Required debugger permission does not bypass Chrome or organization restrictions. The extension checks actual passive API access; missing, rejected or timed-out access is unavailable, as is a tab absent from inspectable targets. It reports reduced coverage without assuming the exact cause. Without positive automation evidence, this gap yields UNMONITORED, never human or safe. Chrome internal pages, Chrome Web Store, other extension pages and incognito (manifest disables it) are not monitored.

Sources: [declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions), [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs), [optional permissions restrictions](https://developer.chrome.com/docs/extensions/reference/api/permissions).
