import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Loading } from "@/components/ui/loading";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePartyStore } from "@/store/usePartyStore";
import { AuthScreen } from "@/components/AuthScreen";
import LandingPageCreative from "@/components/LandingPageCreative";
import { useAuth } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PWAInstallBanner } from "@/components/PWAInstallBanner";
import { lazy, Suspense, useEffect, useState } from "react";
import { HardenedErrorBoundary } from '@/components/HardenedErrorBoundary';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { initializeAuthStateListener } from '@/lib/auth';
import { RoleGuard } from "@/components/RoleGuard";

const PartyCultureBlog = lazy(() => import("@/components/PartyCultureBlog"));
const EventCreation = lazy(() => import("@/components/EventCreation").then(m => ({ default: m.EventCreation })));
const EventManagement = lazy(() => import("@/components/EventManagement").then(m => ({ default: m.EventManagement })));
const QRScanner = lazy(() => import("@/components/QRScanner").then(m => ({ default: m.QRScanner })));
const GuestView = lazy(() => import("@/components/GuestView").then(m => ({ default: m.GuestView })));

/** Adapts the route param to GuestView's required prop. */
const GuestViewRoute = () => {
  const { guestId } = useParams<{ guestId: string }>();
  return <GuestView guestId={guestId ?? ''} />;
};

const TemplateManager = lazy(() => import("@/components/TemplateManager"));
const JoinEventPage = lazy(() => import("@/components/JoinEventPage").then(m => ({ default: m.JoinEventPage })));
const RoleSelection = lazy(() => import("@/components/RoleSelection").then(m => ({ default: m.RoleSelection })));
const Logout = lazy(() => import("@/components/Logout"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const SocialFeedPage = lazy(() => import("@/pages/SocialFeedPage"));
const ExplorePage = lazy(() => import("@/pages/ExplorePage"));
const UserDashboard = lazy(() => import("@/pages/UserDashboard"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"));
const PrivacySettingsPage = lazy(() => import("@/pages/PrivacySettingsPage"));
const VerifyEmailPage = lazy(() => import("@/pages/VerifyEmailPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));

const QUERY_STALE_MS = 30_000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: QUERY_STALE_MS, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

const PageFallback = () => <Loading fullScreen size="lg" />;

const AuthenticatedApplication = () => {
  const user = usePartyStore(s => s.user);
  const persistedCurrentEvent = usePartyStore(s => s.currentEvent);
  const events = usePartyStore(s => s.events);
  const { isLoading } = useAuth();
  const [userIntent, setUserIntent] = useState<'create_event' | 'join_event' | 'explore_features'>('explore_features');

  useEffect(() => { initializeAuthStateListener(); }, []);

  if (isLoading) return <Loading fullScreen size="lg" />;
  if (persistedCurrentEvent && (!events || events.length === 0) && user) return <Loading fullScreen size="lg" />;

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <HardenedErrorBoundary>
            <div className="min-h-screen bg-background text-foreground">
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={!user ? <LandingPageCreative onStartAuth={(intent) => setUserIntent(intent)} /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/auth" element={!user ? <AuthScreen initialMode="auth" userIntent={userIntent} /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/auth/verify-email" element={<VerifyEmailPage />} />
                  <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/join/:token" element={<JoinEventPage />} />
                  <Route path="/join/*" element={<JoinEventPage />} />
                  <Route path="/dashboard" element={<ProtectedRoute><UserDashboard /></ProtectedRoute>} />
                  <Route path="/create-event" element={<ProtectedRoute><RoleGuard allowedRoles={['creator']}><EventCreation /></RoleGuard></ProtectedRoute>} />
                  <Route path="/event-management" element={<ProtectedRoute><RoleGuard allowedRoles={['creator']}><EventManagement /></RoleGuard></ProtectedRoute>} />
                  <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
                  <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
                  <Route path="/privacy-settings" element={<ProtectedRoute><PrivacySettingsPage /></ProtectedRoute>} />
                  <Route path="/templates" element={<ProtectedRoute><TemplateManager /></ProtectedRoute>} />
                  <Route path="/profile/:id" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
                  <Route path="/feed" element={<ProtectedRoute><SocialFeedPage /></ProtectedRoute>} />
                  <Route path="/explore" element={<ProtectedRoute><ExplorePage /></ProtectedRoute>} />
                  <Route path="/party-culture-blog" element={<PartyCultureBlog />} />
                  <Route path="/qr-scanner" element={<ProtectedRoute><RoleGuard allowedRoles={['creator']}><QRScanner /></RoleGuard></ProtectedRoute>} />
                  <Route path="/role-selection" element={<ProtectedRoute><RoleSelection /></ProtectedRoute>} />
                  <Route path="/guest-view/:guestId" element={<GuestViewRoute />} />
                  <Route path="/logout" element={<Logout />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </Suspense>
            </div>
            <PWAInstallBanner />
            <Toaster />
            <Sonner />
          </HardenedErrorBoundary>
        </TooltipProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

const App = () => {
  // The RSVP page is a public route: a guest who clicks an emailed link has
  // no session yet, and initialising the full authenticated shell (session
  // listener, landing/auth effect, every lazy route) before rendering it
  // both costs the mount and makes a signed-out guest's first network call
  // one the auth middleware has to ignore. /join/ mounts a bare router, so
  // nothing of the authenticated application is constructed there.
  if (/^\/join(?:\/|$)/.test(window.location.pathname)) {
    return (
      <BrowserRouter>
        <HardenedErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/join/:token" element={<JoinEventPage />} />
              <Route path="/join/*" element={<JoinEventPage />} />
            </Routes>
          </Suspense>
        </HardenedErrorBoundary>
      </BrowserRouter>
    );
  }
  return <AuthenticatedApplication />;
};

export default App;
