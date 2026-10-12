import { usePartyStore } from '@/store/usePartyStore';
import { useNavigate } from 'react-router-dom';
import { Plus, Calendar, Users, BarChart2, ArrowRight, Sparkles, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageShell, UserMenu } from '@/components/layout/PageShell';
import { PastelCard } from '@/components/ui/PastelCard';
import { format } from 'date-fns';
import { BrandLockup } from '@/components/BrandMark';

export default function CreatorDashboard() {
  const user = usePartyStore((s) => s.user);
  const events = usePartyStore((s) => s.events);
  const navigate = useNavigate();
  const setCurrentEvent = usePartyStore((s) => s.setCurrentEvent);

  const name = user?.name || user?.email || 'Creator';
  const upcomingEvents = events.filter(
    (e) => new Date(e.start_date || e.date || '') >= new Date()
  );
  const totalGuests = events.reduce((sum, e) => sum + (e.max_guests || 0), 0);

  const handleEventClick = async (event: typeof events[0]) => {
    await setCurrentEvent(event);
    navigate('/event-management');
  };

  return (
    <PageShell
      title={<BrandLockup />}
      subtitle="Creator Studio"
      maxWidth="xl"
      actions={<UserMenu showSettingsButton />}
    >
        {/* Welcome + Create CTA */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Welcome back, {name.split(' ')[0]}</h2>
            <p className="text-muted-foreground text-sm mt-1">Manage your events and grow your audience</p>
          </div>
          <Button className="gap-2 shadow-md" onClick={() => navigate('/create-event')}>
            <Plus className="h-4 w-4" /> New Event
          </Button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Events', value: events.length, icon: Calendar, variant: 'lavender' as const },
            { label: 'Upcoming', value: upcomingEvents.length, icon: Sparkles, variant: 'peach' as const },
            { label: 'Total Guests', value: totalGuests, icon: Users, variant: 'mint' as const },
            { label: 'Analytics', value: 'Soon', icon: BarChart2, variant: 'butter' as const },
          ].map(({ label, value, icon: Icon, variant }) => (
            <PastelCard key={label} variant={variant}>
              <div className="flex items-center gap-3">
                <div className="pastel-icon-wrap">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </div>
            </PastelCard>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: Plus, label: 'Create Event', page: '/create-event', variant: 'peach' as const },
            { icon: Sparkles, label: 'Templates', page: '/templates', variant: 'lavender' as const },
            { icon: QrCode, label: 'QR Scanner', page: '/qr-scanner', variant: 'teal' as const },
            { icon: Users, label: 'Crew', page: '/feed', variant: 'mint' as const },
          ].map(({ icon: Icon, label, page, variant }) => (
            <button
              key={page}
              onClick={() => navigate(page)}
              className="w-full"
            >
              <PastelCard variant={variant}>
                <div className="flex flex-col items-center gap-2">
                  <div className="pastel-icon-wrap">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-medium text-foreground">{label}</span>
                </div>
              </PastelCard>
            </button>
          ))}
        </div>

        {/* Events List */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground">Your Events</h3>
            <Badge variant="outline">{events.length} total</Badge>
          </div>

          {events.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="font-medium text-foreground">No events yet</p>
                <p className="text-sm text-muted-foreground mt-1">Create your first event to get started</p>
                <Button className="mt-4" onClick={() => navigate('/create-event')}>
                  <Plus className="h-4 w-4 mr-2" /> Create Event
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <Card
                  key={event.id}
                  className="cursor-pointer hover:shadow-md hover:border-orange-200 transition-all"
                  onClick={() => handleEventClick(event)}
                >
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{event.name}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {event.start_date
                            ? format(new Date(event.start_date), 'MMM d, yyyy')
                            : event.date
                            ? format(new Date(event.date), 'MMM d, yyyy')
                            : 'Date TBD'}
                        </span>
                        {event.location && (
                          <span className="truncate">{event.location}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Badge
                        variant="secondary"
                        className={
                          event.is_public
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-gray-100 text-gray-600'
                        }
                      >
                        {event.is_public ? 'Public' : 'Private'}
                      </Badge>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
    </PageShell>
  );
}
