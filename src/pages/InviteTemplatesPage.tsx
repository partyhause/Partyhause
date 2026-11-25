import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '@/components/layout/PageShell';
import { TemplateManager } from '@/components/TemplateManager';
import { Mail } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export const InviteTemplatesPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <PageShell
      title="Invite Templates"
      subtitle="Reusable email templates for your event invitations"
      maxWidth="xl"
      onBack={() => navigate('/dashboard')}
    >
      <Card className="border-0 shadow-none">
        <CardContent className="p-0">
          <div className="mb-4 flex items-center gap-2">
            <Mail className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Invitation Designs</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            Create and manage reusable email invitation templates. PartyPlates event templates
            can also be used as invite designs when shared with guests.
          </p>
          <TemplateManager />
        </CardContent>
      </Card>
    </PageShell>
  );
};

export default InviteTemplatesPage;
