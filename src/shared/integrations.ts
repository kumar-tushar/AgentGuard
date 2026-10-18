import type { Framework } from './intelligence';
export type TrustProvider = 'aim' | 'registry';
export interface TrustLookup {
  framework: Framework;
  provider: TrustProvider;
  status: 'listed' | 'not_listed' | 'unavailable';
  score: number | null;
  registryLevel: number | null;
  controllerVerified: false;
}
export interface SiteDeclaration {
  status: 'claims' | 'no_usable_claims' | 'unavailable';
  claims: Partial<Record<'ai-safe' | 'injection-protected' | 'consistent-rendering', boolean>>;
  verified: false;
}
