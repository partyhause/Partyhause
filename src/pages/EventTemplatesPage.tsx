import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '@/components/layout/PageShell';
import { PartyPlateSelection } from '@/components/templates/EventTemplateSelection';
import { Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export const EventTemplatesPage: React.FC = () => {
  const navigate = useNavigate();

  const handleSelectTemplate = (template: any) => {
    navigate('/create-event', { state: { template } });
  };

  return (
    <PageShell
      title="PartyPlates — Event Templates"
      subtitle="Ready-made event forms for different occasions"
      maxWidth="xl"
      onBack={() => navigate('/dashboard')}
    >
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          <h1 className="text-2xl font-bold text-gray-900">PartyPlates</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Each template includes custom fields, timeline suggestions, and invitation designs
          that can be reused across events.
        </p>
        <PartyPlateSelection
          onSelectTemplate={handleSelectTemplate}
          onBack={() => navigate('/dashboard')}
        />
      </div>
    </PageShell>
  );
};

export default EventTemplatesPage;
