import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';

export interface PartyPlate {
  id: string;
  name: string;
  description?: string;
  category: string;
  hero_image_url?: string;
  price_tier: string;
  default_payload?: unknown;
  featured?: boolean;
  usage_count?: number;
  author_id?: string | null;
}

/** System templates shipped with the app so PartyPlates renders
 *  even when the API returns empty (migrations not yet applied). */
const FALLBACK_SYSTEM: PartyPlate[] = [
  {
    id: 'fallback-birthday',
    name: 'Birthday Celebration',
    slug: 'birthday-celebration',
    description: 'Celebrate with friends, cake, and balloons.',
    category: 'birthday',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: {},
    required_fields_schema: null,
    featured: true,
    published: true,
    usage_count: 0,
    author_id: null,
  },
  {
    id: 'fallback-wedding',
    name: 'Wedding Celebration',
    slug: 'wedding-celebration',
    description: 'Say I do with a beautifully planned wedding.',
    category: 'wedding',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: {},
    required_fields_schema: null,
    featured: true,
    published: true,
    usage_count: 0,
    author_id: null,
  },
  {
    id: 'fallback-conference',
    name: 'Professional Conference',
    slug: 'professional-conference',
    description: 'Host a business conference with speakers and sessions.',
    category: 'conference',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: {},
    required_fields_schema: null,
    featured: true,
    published: true,
    usage_count: 0,
    author_id: null,
  },
  {
    id: 'fallback-festival',
    name: 'Music Festival',
    slug: 'music-festival',
    description: 'Multi-stage festival with food and camping.',
    category: 'festival',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: {},
    required_fields_schema: null,
    featured: false,
    published: true,
    usage_count: 0,
    author_id: null,
  },
  {
    id: 'fallback-block-party',
    name: 'Block Party',
    slug: 'block-party',
    description: 'Neighborhood gathering with food and music.',
    category: 'block-party',
    hero_image_url: null,
    price_tier: 'free',
    default_payload: {},
    required_fields_schema: null,
    featured: false,
    published: true,
    usage_count: 0,
    author_id: null,
  },
];

export const usePartyPlates = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['partyplates'],
    queryFn: async () => {
      try {
        const res = await apiGet<{ system: PartyPlate[]; mine: PartyPlate[]; templates: PartyPlate[] }>('/api/event-templates/');
        const system = res.data?.system ?? [];
        const mine = res.data?.mine ?? [];
        // Fall back to shipped system templates when the API returns empty.
        const finalSystem = system.length > 0 ? system : FALLBACK_SYSTEM;
        return { system: finalSystem, mine, templates: [...finalSystem, ...mine] };
      } catch {
        // Network or transport error — use fallback system templates.
        return { system: FALLBACK_SYSTEM, mine: [], templates: [...FALLBACK_SYSTEM] };
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  return {
    system: data?.system ?? [],
    mine: data?.mine ?? [],
    templates: data?.templates ?? [],
    isLoading,
    error,
  };
};
