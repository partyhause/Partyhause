import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type Variant = 'lavender' | 'pink' | 'peach' | 'butter' | 'mint' | 'teal' | 'default';

interface PastelCardProps {
  variant?: Variant;
  className?: string;
  children: ReactNode;
}

export function PastelCard({ variant = 'default', className, children }: PastelCardProps) {
  return (
    <div
      className={cn(
        'pastel-card',
        variant !== 'default' && `pastel-card--${variant}`,
        className
      )}
    >
      {children}
    </div>
  );
}
