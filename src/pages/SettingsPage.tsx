import { useState } from 'react';
import { usePartyStore } from '@/store/usePartyStore';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PageShell, useBackToDashboard } from '@/components/layout/PageShell';
import { useOnboardingState } from '@/hooks/use-onboarding';
import { UsernamePicker } from '@/components/onboarding/UsernamePicker';
import { DeleteAccountCard } from '@/components/settings/DeleteAccountCard';
import { AtSign, User, Bell, Shield, LogOut, ChevronRight } from 'lucide-react';

interface SettingsItem {
  icon: typeof User;
  label: string;
  description: string;
  page: string;
}

export default function SettingsPage() {
  const user = usePartyStore((s) => s.user);
  const setCurrentPage = usePartyStore((s) => s.setCurrentPage);
  const { signOut } = useAuth();
  const handleBack = useBackToDashboard();
  const { state: onboarding } = useOnboardingState();
  const [editingUsername, setEditingUsername] = useState(false);

  const name = user?.name || user?.email || 'User';
  const role = user?.role || 'user';

  const handleLogout = async () => {
    await signOut();
    setCurrentPage('auth');
  };

  /**
   * The account is already gone by the time this runs.
   *
   * `signOut` is still the right call rather than a bare redirect: it clears
   * both localStorage keys, and a session is the conjunction of the two
   * (src/hooks/use-auth.ts). Leaving either behind renders as a signed-in user
   * whose every request now 401s. The logout request itself failing is
   * expected and harmless, because the token it would revoke no longer
   * belongs to an account.
   */
  const handleAccountDeleted = async () => {
    await signOut();
    setCurrentPage('auth');
  };

  const settingsItems: SettingsItem[] = [
    { icon: User, label: 'Profile', page: 'profile', description: 'View and edit your profile' },
    { icon: Bell, label: 'Notifications', page: 'notifications', description: 'Activity from your crew and events' },
    { icon: Shield, label: 'Privacy', page: 'privacy-settings', description: 'Control what others can see' },
  ];

  return (
    <PageShell title="Settings" maxWidth="sm" onBack={handleBack}>
      {/* Account Info */}
      <Card>
        <CardContent className="p-4 flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="bg-orange-100 text-orange-600 font-bold text-xl">
              {name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold text-foreground">{name}</p>
            <p className="text-sm text-muted-foreground capitalize">{role}</p>
          </div>
        </CardContent>
      </Card>

      {/*
        Username.

        Inline rather than a new `currentPage` key. That state machine already
        carries four handled keys with no setter (AGENTS.md, known gap 6), and
        its type ends in `| string` so the literal set is not enforced. Adding a
        fifth key is adding to a known problem; expanding in place is not.

        Hidden entirely until the state loads, because a card that reports a
        handle and then changes it a moment later reads as a bug.
      */}
      {onboarding ? (
        <Card>
          <CardContent className="p-4">
            {editingUsername ? (
              <UsernamePicker
                state={onboarding}
                heading="Change your username"
                description="People find and tag you by this handle. Changing it releases the old one."
                submitLabel="Save username"
                onDone={() => setEditingUsername(false)}
              />
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-4 text-left"
                onClick={() => setEditingUsername(true)}
              >
                <div className="rounded-xl bg-muted p-2">
                  <AtSign className="h-5 w-5 text-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground">Username</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    @{onboarding.username}
                    {onboarding.username_is_generated ? ' (assigned automatically)' : ''}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Settings List */}
      <div className="space-y-2">
        {settingsItems.map(({ icon: Icon, label, page, description }) => (
          <button
            key={label}
            type="button"
            className="w-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setCurrentPage(page)}
          >
            <Card className="hover:shadow-md transition-all">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-2 rounded-xl bg-muted">
                  <Icon className="h-5 w-5 text-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {/* Switch Role */}
      <button
        type="button"
        className="w-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setCurrentPage('switch-role')}
      >
        <Card className="hover:shadow-md transition-all">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2 rounded-xl bg-orange-50">
              <User className="h-5 w-5 text-orange-600" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-foreground">Switch Role</p>
              <p className="text-xs text-muted-foreground">Change your account type</p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      </button>

      {/* Logout */}
      <Button variant="destructive" className="w-full" onClick={handleLogout}>
        <LogOut className="h-4 w-4 mr-2" />
        Logout
      </Button>

      {/*
        Permanent deletion. Last on the page and visually separated, because it
        is the one control here that cannot be undone. The server, the shared
        client and the mobile screen have carried this flow since the account
        surface was written; the web had no deletion control of any kind until
        now, which mattered little while guests never registered and matters a
        great deal now that RSVP requires an account.
      */}
      <div className="pt-2">
        <DeleteAccountCard onDeleted={handleAccountDeleted} />
      </div>
    </PageShell>
  );
}
