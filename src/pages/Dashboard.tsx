import { usePartyStore } from '@/store/usePartyStore';
import { useNavigate } from 'react-router-dom';
import { Plus, Calendar, Users, BarChart2, Sparkles, QrCode, Search, Ticket, Star, MapPin, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageShell, UserMenu } from '@/components/layout/PageShell';
import { PastelCard } from '@/components/ui/PastelCard';
import { BrandLockup } from '@/components/BrandMark';
import { format } from 'date-fns';

export default function Dashboard() {
  const user = usePartyStore((s) => s.user);
  const events = usePartyStore((s) => s.events);
  const navigate = useNavigate();
  const setCurrentEvent = usePartyStore((s) => s.setCurrentEvent);

  const isCreator = user?.role === 'creator';
  const name = user?.name || user?.email || 'Guest';
  const upcomingEvents = events.filter(e => new Date(e.start_date || e.date || '') >= new Date());
  const totalGuests = events.reduce((sum, e) => sum + (e.max_guests || 0), 0);

  const handleEventClick = async (event: typeof events[0]) => {
    await setCurrentEvent(event);
    navigate('/event-management');
  };

  return (
    <PageShell
      title={<BrandLockup />}
      subtitle={isCreator ? 'Creator Studio' : 'Attendee'}
      maxWidth="xl"
      actions={<UserMenu showSettingsButton={isCreator} />}
    >
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            {isCreator ? `Welcome back, ${name.split(' ')[0]}` : `Hey, ${name.split(' ')[0]} 👋`}
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            {isCreator ? 'Manage your events and grow your audience' : 'Discover events and manage your RSVPs'}
          </p>
        </div>
        {isCreator && (
          <Button className="gap-2" onClick={() => navigate('/create-event')}>
            <Plus className="h-4 w-4" /> New Event
          </Button>
        )}
      </div>

      {isCreator ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Events', value: events.length, icon: Calendar, variant: 'lavender' as const },
              { label: 'Upcoming', value: upcomingEvents.length, icon: Sparkles, variant: 'peach' as const },
              { label: 'Total Guests', value: totalGuests, icon: Users, variant: 'mint' as const },
              { label: 'Analytics', value: 'Soon', icon: BarChart2, variant: 'butter' as const },
            ].map(({ label, value, icon: Icon, variant }) => (
              <PastelCard key={label} variant={variant}>
                <div className="flex items-center gap-3">
                  <div className="pastel-icon-wrap"><Icon className="h-5 w-5" /></div>
                  <div>
                    <p className="text-xl font-bold text-foreground">{value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </div>
              </PastelCard>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: Plus, label: 'Create Event', page: '/create-event', variant: 'peach' as const },
              { icon: Sparkles, label: 'PartyPlates', page: '/templates', variant: 'lavender' as const },
              { icon: QrCode, label: 'QR Scanner', page: '/qr-scanner', variant: 'teal' as const },
              { icon: Users, label: 'Crew', page: '/feed', variant: 'mint' as const },
              { icon: Sparkles, label: 'AI Planner', page: '/ai-planner', variant: 'butter' as const },
            ].map(({ icon: Icon, label, page, variant }) => (
              <button key={page} onClick={() => navigate(page)} className="w-full">
                <PastelCard variant={variant}>
                  <div className="flex flex-col items-center gap-2">
                    <div className="pastel-icon-wrap"><Icon className="h-5 w-5" /></div>
                    <span className="text-xs font-medium text-foreground">{label}</span>
                  </div>
                </PastelCard>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: Search, label: 'Explore', to: '/explore', variant: 'lavender' as const },
            { icon: Ticket, label: 'My Tickets', to: '/dashboard', variant: 'peach' as const },
            { icon: Users, label: 'Friends', to: '/feed', variant: 'mint' as const },
            { icon: Star, label: 'Saved', to: '/dashboard', variant: 'butter' as const },
          ].map(({ icon: Icon, label, to, variant }) => (
            <button key={label} onClick={() => navigate(to)} className="w-full">
              <PastelCard variant={variant}>
                <div className="flex flex-col items-center gap-2">
                  <div className="pastel-icon-wrap"><Icon className="h-5 w-5" /></div>
                  <span className="text-xs font-medium text-foreground">{label}</span>
                </div>
              </PastelCard>
            </button>
          ))}
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">
            {isCreator ? 'Your Events' : 'Your Upcoming Events'}
          </h3>
          <Badge variant="outline">{events.length} total</Badge>
        </div>

        {events.length === 0 ? (
          <PastelCard variant="lavender">
            <div className="p-8 text-center">
              <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="font-medium text-foreground">
                {isCreator ? 'No events yet' : 'No upcoming events'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {isCreator ? 'Create your first event to get started' : 'Find events near you and RSVP!'}
              </p>
              <Button className="mt-4" onClick={() => navigate(isCreator ? '/create-event' : '/explore')}>
                {isCreator ? 'Create Event' : 'Explore Events'}
              </Button>
            </div>
          </PastelCard>
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <PastelCard key={event.id} variant="default" onClick={() => handleEventClick(event)} className="cursor-pointer">
                <div className="p-4 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">{event.name}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {event.start_date ? format(new Date(event.start_date), 'MMM d, yyyy') : event.date ? format(new Date(event.date), 'MMM d, yyyy') : 'Date TBD'}
                      </span>
                      {event.location && <span className="truncate">{event.location}</span>}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground ml-4" />
                </div>
              </PastelCard>
            ))}
          </div>
        )}
      </section>

      {!isCreator && (
        <div className="rounded-2xl border border-dashed border-orange-200 bg-orange-50 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-orange-700">Want to host events?</p>
            <p className="text-xs text-orange-600 mt-0.5">Switch to a Creator account</p>
          </div>
          <Button size="sm" variant="outline" className="border-orange-400 text-orange-600 hover:bg-orange-100" onClick={() => navigate('/role-selection')}>
            Upgrade
          </Button>
        </div>
      )}
    </PageShell>
  );
}
