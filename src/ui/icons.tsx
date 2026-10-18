import type { ReactNode } from 'react';

const paths = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  sessions: <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5m4-1v5l3 2" /></>,
  controls: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
  traffic: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  integrations: <><path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)" /></>,
  policy: <><path d="M12 3 4 6v6c0 4 5 8 8 9 3-1 8-5 8-9V6l-8-3Z" /><path d="M12 8v5m0 3h.01" /></>,
  coverage: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="m12 12 7-7" /></>,
  audit: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6m-6 4h6m-6 4h4" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 11.5-1.5L20 8M4 16l2.5 2.5A7 7 0 0 0 18 17" /></>,
  settings: <><path d="m9 3-.5 3-2 1.2L3.7 6 1.8 9.3 4 11v2l-2.2 1.7L3.7 18l2.8-1.2 2 1.2.5 3h4l.5-3 2-1.2 2.8 1.2 1.9-3.3L18 13v-2l2.2-1.7L18.3 6l-2.8 1.2-2-1.2L13 3H9Z" transform="translate(1 0)" /><circle cx="12" cy="12" r="3" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>,
} satisfies Record<string, ReactNode>;

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
