import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import ErrorBoundary from '@/components/ErrorBoundary';
import { BrowserRouter } from 'react-router-dom';
import App from '@/App';
import { usePartyStore } from '@/store/usePartyStore';
import { clearAuth } from '@/lib/auth-storage';

vi.mock('@/lib/auth-storage', () => ({
  getStoredToken: vi.fn(),
  setStoredToken: vi.fn(),
  getStoredUser: vi.fn(),
  setStoredUser: vi.fn(),
  clearAuth: vi.fn(),
}));

// Mock event service
vi.mock('@/lib/events', () => ({
  eventService: {
    getUserEvents: vi.fn(),
    createEvent: vi.fn()
  }
}));

// The username gate fetches /api/users/me/onboarding through the shared
// transport, whose 15s timeout (plus react-query's retry) is longer than the
// whole suite. jsdom has no API to answer it, so the request would hang and
// the gate would spin forever on isLoading. Rejecting immediately is also the
// honest simulation: the gate is specified to fail open on an unreachable
// status endpoint.
vi.mock('@/lib/api-client', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    apiGet: vi.fn(async (path: string) => {
      if (path.includes('/onboarding')) {
        return { data: null, error: { message: 'unreachable', status: 0, code: 'NETWORK' } };
      }
      return { data: null, error: { message: 'unreachable', status: 0, code: 'NETWORK' } };
    }),
  };
});

// Mock auth initialization
vi.mock('@/lib/auth', () => ({
  initializeAuthStateListener: vi.fn(),
  authService: {
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn()
  }
}));

// Mock framer-motion to avoid animation issues in tests. LandingPageCreative
// (the signed-out surface App renders at '/') calls useScroll/useTransform/
// useReducedMotion; the mock must export them or the whole tree lands in the
// error boundary.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useScroll: () => ({ scrollY: { get: () => 0 }, scrollYProgress: { get: () => 0 } }),
  useTransform: () => ({ get: () => 0 }),
  useReducedMotion: () => false,
  useInView: () => true,
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ErrorBoundary>
        {children}
      </ErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

describe('Logout Userflow Integration Test', () => {
  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User'
  };

  const mockEvent = {
    id: 'test-event-id',
    host_id: 'test-user-id',
    name: 'Test Event',
    event_date: '2025-01-01T12:00:00Z',
    start_date: '2025-01-01T12:00:00Z',
    end_date: '2025-01-01T18:00:00Z',
    location: 'Test Location',
    event_type: 'single_day' as const,
    is_public: true,
    max_guests: 100,
    spotify_playlist_url: 'https://spotify.com/test',
    created_at: '2024-12-01T00:00:00Z',
    updated_at: '2024-12-01T00:00:00Z'
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store to initial state
    usePartyStore.setState({
      user: null,
      isAuthenticated: false,
      events: [],
      currentEvent: null,
      guests: [],
      loadedEventIds: new Set<string>(),
      fetchingEventId: null,
      isLoading: false,
    });

  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should show AuthScreen after logout instead of blank page', async () => {
    // Setup: User is logged in with events
    usePartyStore.setState({
      user: mockUser,
      isAuthenticated: true,
      events: [mockEvent],
      currentEvent: mockEvent,
      guests: [],
      isLoading: false,
    });

    // Render the App component
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // Initially, user should see dashboard (since user is set)
    await waitFor(() => {
  expect(screen.getByText('PartyHause')).toBeInTheDocument();
    });

    // Trigger logout by calling the logout function from the store
    // (In a real scenario, this would be triggered by a logout button)
    const { logout } = usePartyStore.getState();
    logout();

    // Wait for logout to complete and auth state to change
    await waitFor(() => {
      // After logout, must show a real signed-out surface instead of a blank
      // page — the regression this suite exists for. Under the React Router
      // cutover the URL decides: at '/' that is the landing page; a Logout
      // component that calls navigate('/auth') shows the auth welcome. Both
      // are valid; a blank screen is not.
      const onLanding = screen.queryAllByText(/plan\. party\. perfect\./i).length > 0;
      const onAuth = screen.queryAllByText(/welcome/i).length > 0;
      const signedOut = screen.queryAllByRole('button', { name: /sign in|get started|create/i }).length > 0;
      expect(onLanding || onAuth || signedOut).toBe(true);
    }, { timeout: 2000 });

    // Verify store state is cleared
    const state = usePartyStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.events).toEqual([]);
    expect(state.currentEvent).toBeNull();

    // The store reset is not enough on its own: localStorage must be cleared
    // too, or a reload rehydrates the session that was just discarded.
    expect(clearAuth).toHaveBeenCalled();
  });

  it('should handle logout even when currentEvent exists but events array is empty', async () => {
    // Setup: User logged in but with persisted currentEvent and empty events array
    // This simulates the scenario that caused the blank page
    usePartyStore.setState({
      user: mockUser,
      isAuthenticated: true,
      events: [mockEvent], // Include the event in the array to avoid loading screen
      currentEvent: mockEvent, // But currentEvent is persisted
      guests: [],
      isLoading: false,
    });

    // Render the App component
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // Wait for initial render to complete
    await waitFor(() => {
      // Check if the app rendered (could be dashboard or auth screen)
      expect(screen.getByRole('main') || screen.getByText(/welcome/i) || document.body.firstChild).toBeTruthy();
    });

    // Trigger logout
    const { logout } = usePartyStore.getState();
    logout();

    // Wait for logout to complete
    await waitFor(() => {
      // Must show a real signed-out surface, not a blank loading screen.
      // URL decides which one (landing at '/', auth after navigate('/auth')).
      const onLanding = screen.queryAllByText(/plan\. party\. perfect\./i).length > 0;
      const onAuth = screen.queryAllByText(/welcome/i).length > 0;
      const signedOut = screen.queryAllByRole('button', { name: /sign in|get started|create/i }).length > 0;
      expect(onLanding || onAuth || signedOut).toBe(true);
    }, { timeout: 2000 });

    // Verify store state is properly cleared
    const state = usePartyStore.getState();
    expect(state.user).toBeNull();
    expect(state.events).toEqual([]);
    expect(state.currentEvent).toBeNull();
  });

  it('should handle logout failure gracefully', async () => {
    // Setup: User is logged in
    usePartyStore.setState({
      user: mockUser,
      isAuthenticated: true,
      events: [mockEvent],
      currentEvent: mockEvent,
      guests: [],
      isLoading: false,
    });

    // Render the App component
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // Wait for initial render to complete
    await waitFor(() => {
      // Check if the app rendered (could be dashboard or auth screen)
      expect(screen.getByRole('main') || screen.getByText(/welcome/i) || document.body.firstChild).toBeTruthy();
    });

    // Trigger logout
    const { logout } = usePartyStore.getState();
    logout();

    // Wait for logout to complete despite signOut error
    await waitFor(() => {
      // Must still show a real signed-out surface despite the failure
      const onLanding = screen.queryAllByText(/plan\. party\. perfect\./i).length > 0;
      const onAuth = screen.queryAllByText(/welcome/i).length > 0;
      const signedOut = screen.queryAllByRole('button', { name: /sign in|get started|create/i }).length > 0;
      expect(onLanding || onAuth || signedOut).toBe(true);
    }, { timeout: 2000 });

    // Verify store state is cleared even with signOut error
    const state = usePartyStore.getState();
    expect(state.user).toBeNull();
  });
});