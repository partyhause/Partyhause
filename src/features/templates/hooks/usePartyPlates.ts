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
  {
    id: 'system-kids-birthday',
    name: 'Kids Birthday Party',
    slug: 'kids-birthday-party',
    description: 'Fun celebration for little ones with games and activities.',
    category: 'kids-birthday',
    icon: 'kids-birthday',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: { event_type: 'single_day', theme: 'kids-birthday', includes_games: true, includes_activities: true },
    required_fields_schema: null,
    featured: false,
    published: true,
    usage_count: 0,
    author_id: null,
    source: 'system',
  },
  {
    id: 'system-product-launch',
    name: 'Product Launch',
    slug: 'product-launch',
    description: 'Unveil your new product with a professional launch event.',
    category: 'product-launch',
    icon: 'product-launch',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: { event_type: 'single_day', theme: 'product-launch', includes_demo: true, includes_press: true },
    required_fields_schema: null,
    featured: false,
    published: true,
    usage_count: 0,
    author_id: null,
    source: 'system',
  },
  {
    id: 'system-fundraiser',
    name: 'Fundraiser Gala',
    slug: 'fundraiser-gala',
    description: 'Raise funds for your cause with an elegant evening event.',
    category: 'fundraiser',
    icon: 'fundraiser',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: { event_type: 'single_day', theme: 'fundraiser', includes_auction: true, includes_dinner: true },
    required_fields_schema: null,
    featured: false,
    published: true,
    usage_count: 0,
    author_id: null,
    source: 'system',
  },
  {
    id: 'system-travel',
    name: 'Group Travel',
    slug: 'group-travel',
    description: 'Plan a group getaway with friends or family.',
    category: 'travel',
    icon: 'travel',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: { event_type: 'multi_day', theme: 'travel', includes_accommodation: true, includes_transport: true },
    required_fields_schema: null,
    featured: false,
    published: true,
    usage_count: 0,
    author_id: null,
    source: 'system',
  },
  {
    id: 'system-workshop',
    name: 'Workshop',
    slug: 'workshop',
    description: 'Hands-on learning session with materials and instruction.',
    category: 'workshop',
    icon: 'workshop',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: { event_type: 'single_day', theme: 'workshop', includes_materials: true, includes_instructor: true },
    required_fields_schema: null,
    featured: false,
    published: true,
    usage_count: 0,
    author_id: null,
    source: 'system',
  },
  {
    id: 'system-hackathon',
    name: 'Hackathon',
    slug: 'hackathon',
    description: 'Intensive coding event to build and ship in a weekend.',
    category: 'hackathon',
    icon: 'hackathon',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: { event_type: 'multi_day', theme: 'hackathon', includes_food: true, includes_prizes: true },
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
