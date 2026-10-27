export const ROUTES = {
  HOME: '/',
  AUTH: '/auth',
  AUTH_VERIFY_EMAIL: '/auth/verify-email',
  AUTH_RESET_PASSWORD: '/auth/reset-password',
  JOIN_TOKEN: '/join/:token',
  JOIN_WILDCARD: '/join/*',
  DASHBOARD: '/dashboard',
  CREATE_EVENT: '/create-event',
  EVENT_MANAGEMENT: '/event-management',
  SETTINGS: '/settings',
  NOTIFICATIONS: '/notifications',
  PRIVACY_SETTINGS: '/privacy-settings',
  TEMPLATES: '/templates',
  PROFILE: '/profile/:id',
  FEED: '/feed',
  EXPLORE: '/explore',
  PARTY_CULTURE_BLOG: '/party-culture-blog',
  QR_SCANNER: '/qr-scanner',
  ROLE_SELECTION: '/role-selection',
  GUEST_VIEW: '/guest-view/:guestId',
  LOGOUT: '/logout',
  CATCH_ALL: '*',
} as const;

export type RouteKey = keyof typeof ROUTES;

export const routePaths = Object.values(ROUTES) as readonly string[];
