/** Legal document versions accepted by the current PartyHause API. */
export const CURRENT_TERMS_VERSION = '2026-09-06';
export const CURRENT_PRIVACY_VERSION = '2026-09-06';
export const LEGAL_EFFECTIVE_DATE = 'September 6, 2026';
export const MINIMUM_ACCOUNT_AGE = 18;

// partyhause.uk, the only live domain: the .com zone was deleted on
// 2026-09-24. Keep in step with server/lib/legal.ts and src/lib/legal.ts.
export const LEGAL_URLS = {
  privacy: 'https://partyhause.uk/privacy.html',
  terms: 'https://partyhause.uk/terms.html',
  support: 'https://partyhause.uk/support.html',
} as const;

export interface SignupConsent {
  ageEligible: true;
  termsVersion: typeof CURRENT_TERMS_VERSION;
  privacyVersion: typeof CURRENT_PRIVACY_VERSION;
}
