import { useState } from 'react'
import { apiPost } from '@/lib/api-client'
import { toast } from '@/components/ui/use-toast'

export interface SavePartyPlatePayload {
  name: string
  description?: string
  category?: string
  event_type?: string
  start_date?: string
  start_time?: string
  end_date?: string
  end_time?: string
  location?: string
  spotify_playlist_url?: string
}

export interface UseSavePartyPlateReturn {
  save: (payload: SavePartyPlatePayload) => Promise<boolean>
  isSaving: boolean
}

export const useSavePartyPlate = (): UseSavePartyPlateReturn => {
  const [isSaving, setIsSaving] = useState(false)

  const save = async (payload: SavePartyPlatePayload): Promise<boolean> => {
    if (!payload.name || !payload.event_type) {
      toast({
        title: 'Missing fields',
        description: 'Name and event type are required',
        variant: 'destructive',
      })
      return false
    }

    setIsSaving(true)
    try {
      await apiPost('/api/event-templates/', {
        name: payload.name,
        description: payload.description,
        category: payload.category ?? 'custom',
        default_payload: {
          event: {
            event_type: payload.event_type,
            start_date: payload.start_date,
            start_time: payload.start_time,
            end_date: payload.end_date,
            end_time: payload.end_time,
            location: payload.location,
            spotify_playlist_url: payload.spotify_playlist_url,
          },
        },
      })
      toast({
        title: 'Saved',
        description: 'PartyPlate saved to Mine',
      })
      return true
    } catch {
      toast({
        title: 'Save failed',
        description: 'Could not save PartyPlate',
        variant: 'destructive',
      })
      return false
    } finally {
      setIsSaving(false)
    }
  }

  return { save, isSaving }
}
