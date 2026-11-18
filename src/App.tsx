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
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { initializeAuthStateListener } from '@/lib/auth';
import { RoleGuard } from "@/components/RoleGuard";
import { ROUTES } from '@/routes';

const PartyCultureBlog = lazy(() => import("@/components/PartyCultureBlog"));
const EventCreation = lazy(() => import("@/components/EventCreation").then(m => ({ default: m.EventCreation })));
const EventManagement = lazy(() => import("@/components/EventManagement").then(m => ({ default: m.EventManagement })));
const QRScanner = lazy(() => import("@/components/QRScanner").then(m => ({ default: m.QRScanner })));
const GuestView = lazy(() => import("@/components/GuestView").then(m => ({ default: m.GuestView })));

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
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const EventTemplatesPage = lazy(() => import("@/pages/EventTemplatesPage"));
const InviteTemplatesPage = lazy(() => import("@/pages/InviteTemplatesPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const AIPlannerChat = lazy(() => import("@/pages/AIPlannerChat"));
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

const AuthenticatedShell = () => {
  const user = usePartyStore(s => s.user);
  const persistedCurrentEvent = usePartyStore(s => s.currentEvent);
  const events = usePartyStore(s => s.events);
  const { isLoading } = useAuth();
  const [userIntent, setUserIntent] = useState<'create_event' | 'join_event' | 'explore_features'>('explore_features');

  useEffect(() => { initializeAuthStateListener(); }, []);

  if (isLoading) return <Loading fullScreen size="lg" />;
  if (persistedCurrentEvent && (!events || events.length === 0) && user) return <Loading fullScreen size="lg" />;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <HardenedErrorBoundary>
          <div className="min-h-screen bg-background text-foreground">
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path={ROUTES.HOME} element={!user ? <LandingPageCreative onStartAuth={(intent) => setUserIntent(intent)} /> : <Navigate to={ROUTES.DASHBOARD} replace />} />
                <Route path={ROUTES.AUTH} element={!user ? <AuthScreen initialMode="auth" userIntent={userIntent} /> : <Navigate to={ROUTES.DASHBOARD} replace />} />
                <Route path={ROUTES.AUTH_VERIFY_EMAIL} element={<VerifyEmailPage />} />
                <Route path={ROUTES.AUTH_RESET_PASSWORD} element={<ResetPasswordPage />} />
                <Route path={ROUTES.JOIN_TOKEN} element={<JoinEventPage />} />
                <Route path={ROUTES.JOIN_WILDCARD} element={<JoinEventPage />} />
                <Route path={ROUTES.DASHBOARD} element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path={ROUTES.CREATE_EVENT} element={<ProtectedRoute><RoleGuard allowedRoles={['creator']}><EventCreation /></RoleGuard></ProtectedRoute>} />
                <Route path={ROUTES.EVENT_MANAGEMENT} element={<ProtectedRoute><RoleGuard allowedRoles={['creator']}><EventManagement /></RoleGuard></ProtectedRoute>} />
                <Route path={ROUTES.SETTINGS} element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
                <Route path={ROUTES.NOTIFICATIONS} element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
                <Route path={ROUTES.PRIVACY_SETTINGS} element={<ProtectedRoute><PrivacySettingsPage /></ProtectedRoute>} />
                <Route path={ROUTES.EVENT_TEMPLATES} element={<ProtectedRoute><EventTemplatesPage /></ProtectedRoute>} />
                <Route path={ROUTES.INVITE_TEMPLATES} element={<ProtectedRoute><InviteTemplatesPage /></ProtectedRoute>} />
                <Route path={ROUTES.PROFILE} element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
                <Route path={ROUTES.FEED} element={<ProtectedRoute><SocialFeedPage /></ProtectedRoute>} />
                <Route path={ROUTES.EXPLORE} element={<ProtectedRoute><ExplorePage /></ProtectedRoute>} />
                <Route path={ROUTES.PARTY_CULTURE_BLOG} element={<PartyCultureBlog />} />
                <Route path={ROUTES.QR_SCANNER} element={<ProtectedRoute><RoleGuard allowedRoles={['creator']}><QRScanner /></RoleGuard></ProtectedRoute>} />
                <Route path={ROUTES.ROLE_SELECTION} element={<ProtectedRoute><RoleSelection /></ProtectedRoute>} />
                <Route path={ROUTES.GUEST_VIEW} element={<GuestViewRoute />} />
                <Route path={ROUTES.LOGOUT} element={<Logout />} />
                <Route path={ROUTES.CATCH_ALL} element={<Navigate to={ROUTES.DASHBOARD} replace />} />
              </Routes>
            </Suspense>
          </div>
          <PWAInstallBanner />
          <Toaster />
          <Sonner />
        </HardenedErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

const JoinShell = () => (
  <HardenedErrorBoundary>
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/join/:token" element={<JoinEventPage />} />
        <Route path="/join/*" element={<JoinEventPage />} />
      </Routes>
    </Suspense>
  </HardenedErrorBoundary>
);

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/join/*" element={<JoinShell />} />
        <Route path="/*" element={<AuthenticatedShell />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
