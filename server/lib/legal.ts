/** Legal document versions accepted by the current account-creation contract. */
export const CURRENT_TERMS_VERSION = '2026-09-06';
export const CURRENT_PRIVACY_VERSION = '2026-09-06';
export const LEGAL_EFFECTIVE_DATE = 'September 6, 2026';
export const MINIMUM_ACCOUNT_AGE = 18;

// partyhause.uk, the only live domain: the .com zone was deleted on
// 2026-09-24. These pages are static files served by the web container, and
// App Store review requires the privacy policy link to resolve.
export const LEGAL_URLS = {
  privacy: 'https://partyhause.uk/privacy.html',
  terms: 'https://partyhause.uk/terms.html',
  support: 'https://partyhause.uk/support.html',
} as const;
