export function createManifest(): chrome.runtime.ManifestV3 {
  return {
    manifest_version: 3,
    name: 'AgentGuard',
    version: '0.1.0',
    description: 'Explainable browser automation signals, local audit and sensitive-domain protection.',
    minimum_chrome_version: '120',
    incognito: 'not_allowed',
    permissions: ['storage', 'scripting', 'alarms', 'debugger', 'webNavigation'],
    optional_permissions: ['declarativeNetRequestWithHostAccess', 'downloads', 'notifications'],
    host_permissions: ['https://*/*', 'http://*/*'],
    content_scripts: [{ matches: ['https://*/*', 'http://*/*'], js: ['sensor.js'], run_at: 'document_start', world: 'ISOLATED', all_frames: false }],
    background: { service_worker: 'background.js', type: 'module' },
    icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    action: { default_popup: 'popup.html', default_title: 'AgentGuard · Browser intelligence', default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } },
    options_ui: { page: 'options.html', open_in_tab: true },
    commands: { 'emergency-contain': { suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' }, description: 'Emergency: quarantine currently detected automation tabs' } },
    storage: { managed_schema: 'managed-schema.json' },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" },
  };
}
