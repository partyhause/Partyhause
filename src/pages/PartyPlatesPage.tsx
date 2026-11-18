import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageShell } from '@/components/layout/PageShell';
import { PartyPlateSelection } from '@/components/templates/EventTemplateSelection';
import { TemplateManager } from '@/components/TemplateManager';
import { Sparkles, Mail } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export const PartyPlatesPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'events' | 'invites'>('events');

  const handleSelectTemplate = (template: any) => {
    navigate('/create-event', { state: { template } });
  };

  return (
    <PageShell
      title="PartyPlates"
      subtitle="Event templates and invitation designs"
      maxWidth="xl"
      onBack={() => navigate('/dashboard')}
    >
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'events' | 'invites')}>
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="events" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Event Templates
          </TabsTrigger>
          <TabsTrigger value="invites" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Invite Templates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="space-y-6">
          <Card className="border-0 shadow-none">
            <CardContent className="p-0">
              <div className="mb-4">
                <h3 className="text-lg font-semibold">PartyPlates - Event Forms</h3>
                <p className="text-sm text-muted-foreground">
                  Ready-made templates for different event types. Each template includes custom fields,
                  timeline suggestions, and invitation designs.
                </p>
              </div>
              <PartyPlateSelection
                onSelectTemplate={handleSelectTemplate}
                onUseAI={() => navigate('/create-event', { state: { useAI: true } })}
                onBack={() => navigate('/dashboard')}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invites" className="space-y-6">
          <Card className="border-0 shadow-none">
            <CardContent className="p-0">
              <TemplateManager />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
};

export default PartyPlatesPage;
