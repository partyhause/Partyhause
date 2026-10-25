import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type Variant = 'lavender' | 'pink' | 'peach' | 'butter' | 'mint' | 'teal' | 'default';

interface PastelCardProps {
  variant?: Variant;
  className?: string;
  children: ReactNode;
  /**
   * Present on several call sites (Dashboard event rows, EventCreation step
   * cards). The component previously dropped the prop, so the cards compiled
   * (where types allowed) but were inert: cursor-pointer with no handler.
   */
  onClick?: () => void;
}

export function PastelCard({ variant = 'default', className, children, onClick }: PastelCardProps) {
  return (
    <div
      className={cn(
        'pastel-card',
        variant !== 'default' && `pastel-card--${variant}`,
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
