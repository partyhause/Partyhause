import { useNavigate } from 'react-router-dom';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { usePartyStore } from '@/store/usePartyStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loading } from '@/components/ui/loading';
import { ArrowLeft, Calendar, MapPin, Music, Plus, QrCode, Users, UserCheck, UserX, Mail, Clock, FileText, Pencil, Loader2, Send } from 'lucide-react';
import format from 'date-fns/format';
import { GuestList } from './GuestList';
import { PollsSection } from '@/features/polls';
import { PartyBoardSection } from '@/features/partyboard';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { eventService } from '@/lib/events';

export const EventManagement = () => {
  const { currentEvent, events, setCurrentEvent, setEvents, guests, isLoading } = usePartyStore();
  const navigate = useNavigate();
  // Ref to track if we've already tried to load guests for this event
  const guestLoadAttempted = useRef<Set<string>>(new Set());
  // Ref to track the last guest count for this event to avoid unnecessary re-fetches
  const lastGuestCount = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (currentEvent || events.length === 0 || isLoading) return;
    // Auto-select the most recent event when arriving without context
    // (e.g. clicking back from the QR scanner with no currentEvent set).
    const latest = events.slice().sort((a, b) => {
      const da = new Date(a.start_date || a.date || 0).getTime();
      const db = new Date(b.start_date || b.date || 0).getTime();
      return db - da;
    })[0];
    void setCurrentEvent(latest);
  }, [currentEvent, events, isLoading, setCurrentEvent]);

  useEffect(() => {
    if (!currentEvent || isLoading) return;

    const eventId = currentEvent.id;
    const eventGuests = guests.filter(g => g.event_id === eventId);
    const currentGuestCount = eventGuests.length;
    const previousGuestCount = lastGuestCount.current.get(eventId) || 0;

    // Only fetch if we haven't tried before AND the guest count hasn't changed
    // This prevents infinite loops when guests array updates but count stays the same
    if (!guestLoadAttempted.current.has(eventId) && currentGuestCount === previousGuestCount) {
      guestLoadAttempted.current.add(eventId);
      setCurrentEvent(currentEvent);
    }

    // Update the last known count
    lastGuestCount.current.set(eventId, currentGuestCount);
  }, [currentEvent?.id, guests.length, isLoading, setCurrentEvent]);

  const [showAddGuest, setShowAddGuest] = useState(false);
  const [guestForm, setGuestForm] = useState({ name: '', email: '' });
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isUpdatingEvent, setIsUpdatingEvent] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    start_date: '',
    start_time: '',
    end_date: '',
    end_time: '',
    location: '',
    description: '',
    event_type: 'single_day' as 'single_day' | 'multi_day'
  });

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const eventGuests = currentEvent ? guests.filter(guest => guest.event_id === currentEvent.id) : [];
  const checkedInCount = eventGuests.filter(guest => guest.checked_in).length;

  /**
   * A published event is the precondition for inviting anybody
   * (server/lib/mvp-invitations.ts:253-260), and until 2026-09-14 no web
   * surface could set it, so every event this client created stayed a draft
   * and no invitation could be sent. Absent `status` is treated as a draft
   * rather than as published: a cached row from before the field was carried
   * on the client should offer the action, not hide it.
   */
  const isDraft = currentEvent ? (currentEvent.status ?? 'draft') === 'draft' : false;

  const handlePublish = async () => {
    if (!currentEvent || isPublishing) return;
    setIsPublishing(true);
    setPublishError(null);

    const result = await eventService.publishEvent(currentEvent.id);

    if ('error' in result) {
      setPublishError(result.error);
      setIsPublishing(false);
      return;
    }

    // Both the detail view and the list carry the row, so both are updated.
    // Refreshing only `currentEvent` leaves the dashboard showing a draft
    // badge for an event that is published, which reads as a failed action.
    setCurrentEvent(result.event);
    setEvents(events.map(event => (event.id === result.event.id ? result.event : event)));
    setIsPublishing(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loading size="lg" />
      </div>
    );
  }

  if (!currentEvent && events.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen text-xl text-muted-foreground">
        Event not found
      </div>
    );
  }

  if (!currentEvent) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loading size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      {/* Liquid Metal Background */}
      <div className="liquid-bg" />
      
      {/* Header with Glass Nav */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-nav sticky top-0 z-10"
      >
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <button
                onClick={() => navigate('/dashboard')}
                className="icon-btn-liquid mr-4"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-metallic">{currentEvent.name}</h1>
                  {isDraft && (
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 bg-amber-500/15 text-amber-700"
                    >
                      Draft
                    </Badge>
                  )}
                </div>
                <p className="text-gray-700">Event Management</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isDraft && (
                <Button
                  onClick={handlePublish}
                  disabled={isPublishing}
                  className="bg-[#c02a16] text-white hover:bg-[#972317]"
                >
                  {isPublishing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Publish event
                    </>
                  )}
                </Button>
              )}
              <button
                onClick={() => navigate('/qr-scanner')}
                className="btn-iridescent"
              >
                <QrCode className="h-4 w-4 mr-2" />
                Scan QR Code
              </button>
            </div>
          </div>
          {isDraft && (
            <p className="mt-2 text-sm text-gray-700">
              Guests cannot be invited until this event is published.
            </p>
          )}
          {publishError && (
            <p role="alert" className="mt-2 text-sm text-[#972317]">
              {publishError}
            </p>
          )}
        </div>
      </motion.header>

      <div className="container mx-auto px-4 py-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Event Details & Stats */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-1 space-y-6"
          >
            {/* Event Info Card */}
            <div className="glass-panel-liquid">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
                <h2 className="text-xl font-bold text-foreground flex items-center">
                  <Calendar className="h-5 w-5 mr-2 text-orange-400" />
                  Event Details
                </h2>
                <button
                  className="btn-glass px-4 py-2 text-sm"
                  onClick={() => {
                    if (!currentEvent) return;
                    const rawStart = currentEvent.start_date || currentEvent.date || new Date().toISOString();
                    const rawEnd = currentEvent.end_date || currentEvent.date || rawStart;
                    const parsedStart = new Date(rawStart);
                    const parsedEnd = new Date(rawEnd);
                    const safeStart = Number.isNaN(parsedStart.getTime()) ? new Date() : parsedStart;
                    const safeEnd = Number.isNaN(parsedEnd.getTime()) ? safeStart : parsedEnd;

                    setEditForm({
                      start_date: format(safeStart, 'yyyy-MM-dd'),
                      start_time: format(safeStart, 'HH:mm'),
                      end_date: format(safeEnd, 'yyyy-MM-dd'),
                      end_time: format(safeEnd, 'HH:mm'),
                      location: currentEvent.location || '',
                      description: currentEvent.description || '',
                      event_type: currentEvent.event_type || 'single_day'
                    });
                    setIsEditingDetails(true);
                  }}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit Details
                </button>
                <button
                  onClick={() => {
                    if (!currentEvent) return;
                    if (
                      window.confirm(
                        `Are you sure you want to cancel "${currentEvent.name}"? This cannot be undone.`
                      )
                    ) {
                      void eventService.deleteEvent(currentEvent.id).then(() => {
                          navigate('/dashboard');
                        })
                        .catch(() => {
                          // fallthrough to generic error path below
                        });
                    }
                  }}
                  className="btn-glass px-4 py-2 text-sm text-red-400 hover:text-red-300"
                >
                  Cancel Event
                </button>
                <div className="flex items-center text-gray-700">
                  <Calendar className="h-4 w-4 mr-2 text-orange-400" />
                  <span>{format(new Date(currentEvent.start_date || currentEvent.date || new Date().toISOString()), 'PPP')}</span>
                  <MapPin className="h-4 w-4 mr-2 text-orange-400" />
                  <span>{currentEvent.location}</span>
                </div>
                {currentEvent.description ? (
                  <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start">
                      <FileText className="h-4 w-4 mr-2 mt-0.5 text-orange-400" />
                      <p className="text-sm text-gray-700 whitespace-pre-line">
                        {currentEvent.description}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-white/20 p-4 text-sm text-gray-400">
                    Add an event description to give guests more context.
                  </div>
                )}
                {currentEvent.spotify_playlist_url && (
                  <div className="flex items-center text-gray-700">
                    <Music className="h-4 w-4 mr-2 text-orange-400" />
                    <span>Spotify Playlist</span>
                  </div>
                )}
              </div>
            </div>

            {/* Stats Panel */}
            <div className="stats-panel">
              <h2 className="text-xl font-bold text-foreground flex items-center col-span-full mb-2">
                <Users className="h-5 w-5 mr-2 text-orange-400" />
                Guest Stats
              </h2>
              
              <div className="stat-item col-span-1">
                <span className="stat-value">{eventGuests.length}</span>
                <span className="stat-label">Total Guests</span>
              </div>
              
              <div className="stat-item col-span-1">
                <span className="stat-value">{checkedInCount}</span>
                <span className="stat-label">Checked In</span>
              </div>
              
              <div className="col-span-full space-y-2 mt-2">
                <div className="flex justify-between text-sm text-gray-700">
                  <span>Check-in Progress</span>
                  <span>{eventGuests.length > 0 ? Math.round((checkedInCount / eventGuests.length) * 100) : 0}%</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-2">
                  <motion.div
                    className="bg-gradient-to-r from-orange-400 to-orange-600 h-2 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${eventGuests.length > 0 ? (checkedInCount / eventGuests.length) * 100 : 0}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
              </div>
            </div>
          </motion.div>

          {/* Main Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="lg:col-span-2 space-y-6"
          >
            {/* Guest List */}
            <div className="glass-panel-liquid">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-foreground flex items-center">
                  <Users className="h-5 w-5 mr-2 text-orange-400" />
                  Guest Management
                </h2>
                <Badge variant="secondary" className="bg-orange-500/20 text-orange-300 border-orange-400/30">
                  {checkedInCount}/{eventGuests.length} Checked In
                </Badge>
              </div>
              <p className="text-gray-700 text-sm mb-4">
                Manage your guest list and track check-ins in real-time
              </p>
              <GuestList eventId={currentEvent.id} />
            </div>

            {/* Polls & Voting Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <PollsSection eventId={currentEvent.id} />
            </motion.div>

            {/* PartyBoard Collaborative Canvas */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
            >
              <PartyBoardSection eventId={currentEvent.id} />
            </motion.div>

            {/* Spotify Playlist */}
            {currentEvent.spotify_playlist_url && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4 }}
              >
                <div className="glass-panel-liquid">
                  <h2 className="text-xl font-bold text-foreground flex items-center mb-4">
                    <Music className="h-5 w-5 mr-2 text-orange-400" />
                    Party Playlist
                  </h2>
                  <p className="text-gray-700 text-sm mb-4">
                    Your collaborative Spotify playlist for the event
                  </p>
                  <div className="aspect-video w-full">
                    <iframe
                      src={`https://open.spotify.com/embed/playlist/${currentEvent.spotify_playlist_url.split('/').pop()}`}
                      width="100%"
                      height="100%"
                      frameBorder="0"
                      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                      loading="lazy"
                      className="rounded-lg"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </motion.div>
        </div>
      </div>

      <Dialog open={isEditingDetails} onOpenChange={setIsEditingDetails}>
        <DialogContent className="glass-panel-liquid sm:max-w-[520px] border-white/20">
          <DialogHeader>
            <DialogTitle className="text-metallic text-xl">Edit Event Details</DialogTitle>
            <DialogDescription className="text-gray-700">
              Adjust the schedule, location, and description for this event. Changes apply immediately.
            </DialogDescription>
          </DialogHeader>
          {editError && (
            <div className="p-4 rounded-lg border border-red-500/20 bg-red-500/10 text-sm text-red-300">
              {editError}
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!currentEvent) return;

              if (!editForm.start_date || !editForm.start_time) {
                setEditError('Please provide a start date and time.');
                return;
              }
              const requiresEndDate = currentEvent.event_type === 'multi_day';
              if (!editForm.end_time || (requiresEndDate && !editForm.end_date)) {
                setEditError('Please provide an end time and end date (for multi-day events).');
                return;
              }

              const selectedStart = new Date(`${editForm.start_date}T${editForm.start_time}:00`);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              if (selectedStart < today) {
                setEditError('Start date and time cannot be in the past.');
                return;
              }

              const effectiveEndDate = requiresEndDate ? editForm.end_date : editForm.start_date;

              const selectedEnd = new Date(`${effectiveEndDate}T${editForm.end_time}:00`);
              if (selectedEnd <= selectedStart) {
                setEditError('End date/time must be after start date/time.');
                return;
              }

              setEditError(null);
              setIsUpdatingEvent(true);

              // Interpret the naive local datetime in the browser's timezone
              // and send a UTC instant (the API parses dates in UTC).
              const startDateTime = new Date(`${editForm.start_date}T${editForm.start_time}:00`).toISOString();
              const endDateTime = new Date(`${effectiveEndDate}T${editForm.end_time}:00`).toISOString();

              try {
                const updates = {
                  start_date: startDateTime,
                  end_date: endDateTime,
                  location: editForm.location.trim(),
                  description: editForm.description.trim() || null,
                  event_type: editForm.event_type
                };

                const updated = await eventService.updateEvent(currentEvent.id, updates);
                if (!updated) {
                  throw new Error('No update payload returned.');
                }

                const normalizedUpdated = {
                  ...currentEvent,
                  ...updated,
                  description: updated.description ?? null,
                  location: updated.location ?? ''
                };

                const nextEvents = events.map((evt) =>
                  evt.id === normalizedUpdated.id ? normalizedUpdated : evt
                );

                setEvents(nextEvents);
                setIsEditingDetails(false);
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to update event.';
                setEditError(message);
              } finally {
                setIsUpdatingEvent(false);
              }
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-start-date" className="text-gray-700">Start Date</Label>
                <input
                  id="edit-start-date"
                  type="date"
                  value={editForm.start_date}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, start_date: e.target.value }))}
                  required
                  className="input-liquid w-full"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-start-time" className="text-gray-700">Start Time</Label>
                <input
                  id="edit-start-time"
                  type="time"
                  value={editForm.start_time}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, start_time: e.target.value }))}
                  required
                  className="input-liquid w-full"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {currentEvent.event_type === 'multi_day' && (
                <div className="space-y-2">
                  <Label htmlFor="edit-end-date" className="text-gray-700">End Date</Label>
                  <input
                    id="edit-end-date"
                    type="date"
                    value={editForm.end_date}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, end_date: e.target.value }))}
                    min={editForm.start_date}
                    required
                    className="input-liquid w-full"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="edit-end-time" className="text-gray-700">End Time</Label>
                <input
                  id="edit-end-time"
                  type="time"
                  value={editForm.end_time}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, end_time: e.target.value }))}
                  required
                  className="input-liquid w-full"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-event-type" className="text-gray-700">Event Type</Label>
              <select
                id="edit-event-type"
                value={editForm.event_type}
                onChange={(e) => setEditForm((prev) => ({ ...prev, event_type: e.target.value as 'single_day' | 'multi_day' }))}
                className="input-liquid w-full"
              >
                <option value="single_day">Single Day</option>
                <option value="multi_day">Multi Day</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-location" className="text-gray-700">Location</Label>
                <input
                  id="edit-location"
                  placeholder="Where is your event taking place?"
                  value={editForm.location}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, location: e.target.value }))}
                  className="input-liquid w-full"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description" className="text-gray-700">Event Description</Label>
              <textarea
                id="edit-description"
                placeholder="Share details your guests should know"
                value={editForm.description}
                onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                rows={4}
                className="input-liquid w-full resize-none"
              />
            </div>

            <DialogFooter className="gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsEditingDetails(false);
                }}
                disabled={isUpdatingEvent}
                className="btn-glass"
              >
                Cancel
              </button>
              <button type="submit" disabled={isUpdatingEvent} className="btn-liquid-metal disabled:opacity-50">
                {isUpdatingEvent && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
