import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface EventTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  default_payload?: Record<string, any>;
}

const TEMPLATES: EventTemplate[] = [
  {
    id: 'birthday',
    name: 'Birthday Party',
    description: 'Celebrate with cake, balloons, and a custom guest list.',
    icon: '🎂',
    color: '#EF4444',
    category: 'birthday',
    default_payload: { event: { event_type: 'single_day', max_guests: 50 } },
  },
  {
    id: 'kids-birthday',
    name: "Kids' Birthday",
    description: 'Face painting, bounce house, and fun activities for little ones.',
    icon: '🦄',
    color: '#EC4899',
    category: 'kids-birthday',
    default_payload: { event: { event_type: 'single_day', max_guests: 30 } },
  },
  {
    id: 'wedding',
    name: 'Wedding',
    description: 'Ceremony, reception, RSVP tracking, and vendor coordination.',
    icon: '💍',
    color: '#8B5CF6',
    category: 'wedding',
    default_payload: { event: { event_type: 'single_day', max_guests: 150 } },
  },
  {
    id: 'conference',
    name: 'Conference',
    description: 'Multi-session agenda, speaker tracks, and attendee management.',
    icon: '🏢',
    color: '#3B82F6',
    category: 'conference',
    default_payload: { event: { event_type: 'multi_day', max_guests: 200 } },
  },
  {
    id: 'product-launch',
    name: 'Product Launch',
    description: 'Reveal your new product with a timed rollout and press list.',
    icon: '🚀',
    color: '#10B981',
    category: 'product-launch',
    default_payload: { event: { event_type: 'single_day', max_guests: 100 } },
  },
  {
    id: 'fundraiser',
    name: 'Fundraiser',
    description: 'Ticket tiers, donation goals, and beneficiary details.',
    icon: '💝',
    color: '#F59E0B',
    category: 'fundraiser',
    default_payload: { event: { event_type: 'single_day', max_guests: 75 } },
  },
  {
    id: 'festival',
    name: 'Festival',
    description: 'Stages, food vendors, lineup schedule, and day passes.',
    icon: '🎪',
    color: '#06B6D4',
    category: 'festival',
    default_payload: { event: { event_type: 'multi_day', max_guests: 500 } },
  },
  {
    id: 'travel',
    name: 'Group Travel',
    description: 'Itinerary, lodging, transport, and shared expense tracking.',
    icon: '✈️',
    color: '#84CC16',
    category: 'travel',
    default_payload: { event: { event_type: 'multi_day', max_guests: 20 } },
  },
  {
    id: 'block-party',
    name: 'Block Party',
    description: 'Street closure, potluck sign-up, and neighborhood outreach.',
    icon: '🏘️',
    color: '#EF4444',
    category: 'block-party',
    default_payload: { event: { event_type: 'single_day', max_guests: 100 } },
  },
  {
    id: 'workshop',
    name: 'Workshop/Class',
    description: 'Hands-on learning, materials list, and session timing.',
    icon: '📚',
    color: '#A855F7',
    category: 'workshop',
    default_payload: { event: { event_type: 'single_day', max_guests: 25 } },
  },
  {
    id: 'hackathon',
    name: 'Hackathon',
    description: '24-hour build sprint, team formation, and judging criteria.',
    icon: '💻',
    color: '#1F2937',
    category: 'hackathon',
    default_payload: { event: { event_type: 'multi_day', max_guests: 80 } },
  },
];

interface PartyPlateSelectionProps {
  onSelectTemplate: (template: EventTemplate) => void;
  onUseAI: () => void;
  onBack?: () => void;
}

export const PartyPlateSelection: React.FC<PartyPlateSelectionProps> = ({
  onSelectTemplate,
  onUseAI,
  onBack,
}) => {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const handleSelect = (template: EventTemplate) => {
    setSelectedTemplate(template.id);
    onSelectTemplate(template);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          {onBack && (
            <Button
              variant="ghost"
              onClick={onBack}
              className="mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          )}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-pink-500 rounded-xl flex items-center justify-center">
                <Wand2 className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-4xl font-bold text-gray-900">
                PartyPlates
              </h1>
            </div>
            <p className="text-lg text-gray-600">
              Ready-made event templates. Pick a plate, fill in your details, and go.
            </p>
          </motion.div>
        </div>

        {/* Templates Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {TEMPLATES.map((template, index) => (
            <motion.div
              key={template.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.05 }}
            >
              <Card
                className={cn(
                  'cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-xl',
                  'border-2 hover:border-orange-500',
                  selectedTemplate === template.id && 'ring-2 ring-orange-500'
                )}
                style={{ borderColor: template.color }}
                onClick={() => handleSelect(template)}
              >
                <CardContent className="p-6">
                  {/* Icon Container */}
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 text-3xl"
                    style={{ backgroundColor: `${template.color}33` }}
                  >
                    {template.icon}
                  </div>

                  {/* Template Name */}
                  <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
                    {template.name}
                  </h3>

                  {/* Description */}
                  <p className="text-sm text-gray-600 line-clamp-2">
                    {template.description}
                  </p>

                  {/* Category Badge */}
                  <div className="mt-4">
                    <span
                      className="inline-block px-3 py-1 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: template.color }}
                    >
                      {template.category}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* AI-Powered Option */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: TEMPLATES.length * 0.05 }}
          className="mt-8"
        >
          <Card className="border-2 border-dashed border-orange-300 hover:border-orange-500 transition-colors cursor-pointer">
            <CardContent className="p-8 text-center">
              <Wand2 className="h-12 w-12 text-orange-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Tell the AI Planner
              </h3>
              <p className="text-gray-600 mb-4">
                Just describe your event in plain language and I'll fill out all the details for you.
              </p>
              <Button variant="outline" className="border-orange-300 text-orange-600 hover:bg-orange-50 flex items-center justify-center gap-2" onClick={onUseAI}>
                <Wand2 className="w-4 h-4 mr-2" />
                Chat with AI Planner
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
};
