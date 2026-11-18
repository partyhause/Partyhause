import React, { useState } from 'react';
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
      title="Event Templates"
      subtitle="Ready-made event forms for different occasions"
      maxWidth="xl"
      onBack={() => navigate('/dashboard')}
    >
      <Card className="border-0 shadow-none">
        <CardContent className="p-0">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            <h2 className="text-lg font-semibold">PartyPlates - Event Forms</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            Each template includes custom fields, timeline suggestions, and invitation designs
            that can be reused across events.
          </p>
          <PartyPlateSelection
            onSelectTemplate={handleSelectTemplate}
            onBack={() => navigate('/dashboard')}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
};

export default EventTemplatesPage;
