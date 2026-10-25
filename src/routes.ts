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
  /** The dashboard avatar's own-profile link; ProfilePage reads the session id. */
  PROFILE_SELF: '/profile',
  ONBOARDING: '/onboarding',
  ONBOARDING_WELCOME: '/onboarding/welcome',
  ONBOARDING_PLANNER_CHAT: '/onboarding/planner-chat',
  ONBOARDING_ORGANIZER_PROFILE: '/onboarding/organizer-profile',
  ONBOARDING_WHERE_YOU_HOST: '/onboarding/where',
  ONBOARDING_AI_WORKFLOW: '/onboarding/ai-workflow',
  ONBOARDING_PLAN: '/onboarding/plan',
  ONBOARDING_ASSISTANT_AUTONOMY: '/onboarding/assistant-autonomy',
  // The mobile funnel's screens, now on web. Separate path vocabulary from
  // the server-named steps above so the two can evolve independently.
  ONBOARDING_ROLE: '/onboarding/role',
  ONBOARDING_INTERESTS: '/onboarding/interests',
  ONBOARDING_PERMISSIONS: '/onboarding/permissions',
  ONBOARDING_PROFILE: '/onboarding/profile',
  ONBOARDING_PAYMENT: '/onboarding/payment',
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
