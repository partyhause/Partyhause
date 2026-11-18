import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';

export interface PartyPlate {
  id: string;
  name: string;
  description?: string;
  category: string;
  icon?: string;
  color?: string;
  hero_image_url?: string;
  price_tier: string;
  default_payload?: unknown;
  required_fields_schema?: unknown;
  featured?: boolean;
  published?: boolean;
  usage_count?: number;
  author_id?: string | null;
  source?: 'system' | 'user';
}

/** Single source of truth for system (PartyPlates) templates.
 *  Used by both the frontend fallback AND should match Django seed_data/.
 *  Keeping them in sync ensures no duplicate templates when API comes online. */
export const SYSTEM_TEMPLATES: PartyPlate[] = [
  {
    id: 'system-birthday',
    name: 'Birthday Celebration',
    slug: 'birthday-celebration',
    description: 'Celebrate with friends, cake, and balloons.',
    category: 'birthday',
    icon: 'birthday',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: { event_type: 'single_day', theme: 'birthday', includes_cake: true, includes_balloons: true },
    required_fields_schema: null,
    featured: true,
    published: true,
    usage_count: 0,
    author_id: null,
    source: 'system',
  },
  {
    id: 'system-wedding',
    name: 'Wedding Celebration',
    slug: 'wedding-celebration',
    description: 'Say I do with a beautifully planned wedding.',
    category: 'wedding',
    icon: 'wedding',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: { event_type: 'single_day', theme: 'wedding', includes_ceremony: true, includes_reception: true },
    required_fields_schema: null,
    featured: true,
    published: true,
    usage_count: 0,
    author_id: null,
    source: 'system',
  },
  {
    id: 'system-conference',
    name: 'Professional Conference',
    slug: 'professional-conference',
    description: 'Host a business conference with speakers and sessions.',
    category: 'conference',
    icon: 'conference',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: { event_type: 'multi_day', theme: 'conference', includes_speakers: true, includes_sessions: true },
    required_fields_schema: null,
    featured: true,
    published: true,
    usage_count: 0,
    author_id: null,
    source: 'system',
  },
  {
    id: 'system-festival',
    name: 'Music Festival',
    slug: 'music-festival',
    description: 'Multi-stage festival with food and camping.',
    category: 'festival',
    icon: 'festival',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: { event_type: 'multi_day', theme: 'festival', includes_stages: true, includes_camping: true },
    required_fields_schema: null,
    featured: false,
    published: true,
    usage_count: 0,
    author_id: null,
    source: 'system',
  },
  {
    id: 'system-block-party',
    name: 'Block Party',
    slug: 'block-party',
    description: 'Neighborhood gathering with food and music.',
    category: 'block-party',
    icon: 'block-party',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: { event_type: 'single_day', theme: 'block-party', includes_food_trucks: true, includes_music: true },
    required_fields_schema: null,
    featured: false,
    published: true,
    usage_count: 0,
    author_id: null,
    source: 'system',
  },
];

export const usePartyPlates = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['partyplates'],
    queryFn: async () => {
      try {
        const res = await apiGet<{ system: PartyPlate[]; mine: PartyPlate[]; templates: PartyPlate[] }>('/api/event-templates/');
        const apiSystem = res.data?.system ?? [];
        const mine = res.data?.mine ?? [];

        // When API returns data, merge: API system templates take precedence,
        // but fall back to SYSTEM_TEMPLATES for any missing categories.
        const apiSystemByCategory = new Map(apiSystem.map(t => [t.category, t]));
        const mergedSystem = SYSTEM_TEMPLATES.map(st => apiSystemByCategory.get(st.category) || st);

        return {
          system: mergedSystem,
          mine,
          templates: [...mergedSystem, ...mine],
        };
      } catch {
        // Network or transport error — use fallback system templates.
        return {
          system: SYSTEM_TEMPLATES,
          mine: [],
          templates: [...SYSTEM_TEMPLATES],
        };
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  return {
    system: data?.system ?? SYSTEM_TEMPLATES,
    mine: data?.mine ?? [],
    templates: data?.templates ?? [...SYSTEM_TEMPLATES],
    isLoading,
    error,
  };
};
