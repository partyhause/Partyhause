import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowLeft,
  Sparkles,
  Wand2,
  Cake,
  Heart,
  Building2,
  Rocket,
  Music2,
  Plane,
  Users,
  Wrench,
  Laptop,
  GraduationCap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { usePartyPlates, SYSTEM_TEMPLATES, type PartyPlate } from '@/features/templates/hooks/usePartyPlates';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export interface EventTemplate extends PartyPlate {}

const ICON_MAP: Record<string, React.ElementType> = {
  birthday: Cake,
  wedding: Heart,
  'kids-birthday': Cake,
  conference: Building2,
  'product-launch': Rocket,
  fundraiser: Heart,
  festival: Music2,
  travel: Plane,
  'block-party': Users,
  workshop: Wrench,
  hackathon: Laptop,
  class: GraduationCap,
  'adult-birthday': Cake,
} as Record<string, React.ElementType>;

interface PartyPlateSelectionProps {
  onSelectTemplate: (template: EventTemplate) => void;
  onBack?: () => void;
}

export const PartyPlateSelection: React.FC<PartyPlateSelectionProps> = ({
  onSelectTemplate,
  onBack,
}) => {
  const { system, mine, isLoading, error } = usePartyPlates();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const handleSelect = (template: EventTemplate) => {
    setSelectedTemplate(template.id);
    onSelectTemplate(template);
  };

  const getTemplateIcon = (icon?: string, category?: string) => {
    if (!icon && !category) return <Sparkles className="w-5 h-5 text-white" />;
    const key = (icon || category || '').toLowerCase();
    const Icon = ICON_MAP[key] || Sparkles;
    return <Icon className="w-5 h-5 text-white" />;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            {onBack && (
              <Button variant="ghost" onClick={onBack} className="mb-4">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            )}
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-pink-500 rounded-xl flex items-center justify-center">
                  <Wand2 className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-4xl font-bold text-gray-900">PartyPlates</h1>
              </div>
              <p className="text-lg text-gray-600">Ready-made event templates. Pick a plate, fill in your details, and go.</p>
            </motion.div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-48 bg-gray-200 animate-pulse rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            {onBack && (
              <Button variant="ghost" onClick={onBack} className="mb-4">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            )}
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-pink-500 rounded-xl flex items-center justify-center">
                  <Wand2 className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-4xl font-bold text-gray-900">PartyPlates</h1>
              </div>
              <p className="text-lg text-gray-600">Ready-made event templates. Pick a plate, fill in your details, and go.</p>
            </motion.div>
          </div>
          <div className="text-center py-20">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <ArrowLeft className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">Failed to load templates</h3>
            <p className="text-gray-600">{error.message}</p>
            <Button onClick={() => window.location.reload()} className="mt-4">
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          {onBack && (
            <Button variant="ghost" onClick={onBack} className="mb-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          )}
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-pink-500 rounded-xl flex items-center justify-center">
                <Wand2 className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-4xl font-bold text-gray-900">PartyPlates</h1>
            </div>
            <p className="text-lg text-gray-600">Ready-made event templates. Pick a plate, fill in your details, and go.</p>
          </motion.div>
        </div>

        {!isLoading && !error && (
          <Tabs defaultValue="discover" className="mb-6">
            <TabsList>
              <TabsTrigger value="discover" className="min-w-[150px] justify-center">
                Discover <Badge variant="secondary">{system.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="mine" className="min-w-[150px] justify-center">
                Mine <Badge variant="secondary">{mine.length}</Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="discover" className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {system.map((template, index) => (
                  <motion.div
                    key={template.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: index * 0.05 }}
                  >
                    <Card
                      className={cn(
                        'cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-xl border-2 hover:border-orange-500',
                        selectedTemplate === template.id && 'ring-2 ring-orange-500 bg-orange-50'
                      )}
                      onClick={() => handleSelect(template)}
                    >
                      <CardContent className="p-6">
                        {template.hero_image_url ? (
                          <img src={template.hero_image_url} alt={template.name} className="w-16 h-16 rounded-2xl mb-4 object-cover" />
                        ) : (
                          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 text-3xl bg-gray-100">
                            {getTemplateIcon(template.icon, template.category)}
                          </div>
                        )}
                        {template.featured && (
                          <Badge variant="outline" className="absolute top-3 right-3 text-xs bg-orange-500 text-white">
                            Featured
                          </Badge>
                        )}
                        <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">{template.name}</h3>
                        <p className="text-sm text-gray-600 line-clamp-2">{template.description}</p>
                        <div className="mt-4">
                          <span className="inline-block px-3 py-1 rounded-full text-xs font-medium text-white bg-orange-500">{template.category}</span>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
                {system.length === 0 && (
                  <div className="col-span-full text-center py-20 text-gray-500">
                    No system templates available.
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="mine" className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {mine.map((template) => (
                  <Card key={template.id} className="cursor-pointer transition-colors hover:bg-muted/50" onClick={() => handleSelect(template)}>
                    <CardContent className="p-6">
                      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 text-3xl bg-gray-100">
                        {getTemplateIcon(template.icon, template.category)}
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900">{template.name}</h3>
                      <p className="text-sm text-gray-600">{template.description}</p>
                    </CardContent>
                  </Card>
                ))}
                {mine.length === 0 && (
                  <div className="col-span-full text-center py-20 text-gray-500">
                    No saved plates yet. Create one from the Discover tab.
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
};
