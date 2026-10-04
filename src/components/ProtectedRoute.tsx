import { useRequireAuth } from '@/hooks/use-auth';
import { Loader2 } from 'lucide-react';
import { OnboardingGate } from '@/components/onboarding/OnboardingGate';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isAuthorized, isLoading } = useRequireAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthorized) {
    // Don't return null - let App.tsx handle routing to AuthScreen
    // This prevents the blank page issue
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  // Every authenticated surface passes through here, which is why the username
  // gate is mounted at this point rather than per page: App.tsx reaches its
  // pages through both a React Router table and a `currentPage` switch, and a
  // gate wired into one of those is walked around by using the other.
  return <OnboardingGate>{children}</OnboardingGate>;
};
