import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type Variant = 'lavender' | 'pink' | 'peach' | 'butter' | 'mint' | 'teal' | 'default';

interface PastelCardProps {
  variant?: Variant;
  className?: string;
  children: ReactNode;
  /** Present on interactive cards (the dashboards render them as buttons). Absent means the card is static. */
  onClick?: () => void | Promise<void>;
}

export function PastelCard({ variant = 'default', className, children, onClick }: PastelCardProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      className={cn(
        'pastel-card',
        variant !== 'default' && `pastel-card--${variant}`,
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  );
}
