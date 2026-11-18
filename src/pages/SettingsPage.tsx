import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePartyStore } from '@/store/usePartyStore';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PageShell, useBackToDashboard } from '@/components/layout/PageShell';
import { useOnboardingState } from '@/hooks/use-onboarding';
import { UsernamePicker } from '@/components/onboarding/UsernamePicker';
import { DeleteAccountCard } from '@/components/settings/DeleteAccountCard';
import { AtSign, User, Bell, Shield, LogOut, ChevronRight, Sparkles } from 'lucide-react';

interface SettingsItem {
  icon: typeof User;
  label: string;
  description: string;
  page: string;
}

export default function SettingsPage() {
  const user = usePartyStore((s) => s.user);
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const handleBack = useBackToDashboard();
  const { state: onboarding } = useOnboardingState();
  const [editingUsername, setEditingUsername] = useState(false);

  const settingsItems: SettingsItem[] = [
    { icon: User, label: 'Profile', page: '/profile', description: 'View and edit your profile' },
    { icon: Bell, label: 'Notifications', page: '/notifications', description: 'Activity from your crew and events' },
    { icon: Shield, label: 'Privacy', page: '/privacy-settings', description: 'Control what others can see' },
    { icon: Sparkles, label: 'AI Event Planner', page: '/ai-planner', description: 'Plan events with AI assistant' },
  ];

  return (
    <PageShell title="Settings" maxWidth="sm" onBack={handleBack}>
      <Card>
        <CardContent className="p-4 flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarFallback>{user?.name?.[0] || 'U'}</AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-xl font-semibold">{user?.name}</h2>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-2 mt-4">
        {settingsItems.map(item => (
          <Card key={item.label}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <item.icon className="h-5 w-5" />
                <div>
                  <p className="font-medium">{item.label}</p>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5" onClick={() => navigate(item.page)} />
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
