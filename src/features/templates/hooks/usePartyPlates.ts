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

export const usePartyPlates = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['partyplates'],
    queryFn: async () => {
      try {
        const res = await apiGet<{ system: PartyPlate[]; mine: PartyPlate[]; templates: PartyPlate[] }>('/api/event-templates/');
        return res.data;
      } catch {
        // Network or transport error — return empty lists so the UI
        // renders empty Discover/Mine tabs instead of crashing.
        return { system: [], mine: [], templates: [] };
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
