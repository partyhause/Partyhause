import * as React from 'react';
import { LucideIcon, LucideProps } from 'lucide-react';
import { cn } from '@/lib/utils';

type PastelTone = 'coral' | 'magenta' | 'teal' | 'periwinkle' | 'cream' | 'neutral' | 'coral-soft' | 'magenta-soft' | 'teal-soft' | 'periwinkle-soft';

const toneClasses: Record<PastelTone, string> = {
  coral: 'icon-pastel-coral',
  'coral-soft': 'icon-pastel-coral-soft',
  magenta: 'icon-pastel-magenta',
  'magenta-soft': 'icon-pastel-magenta-soft',
  teal: 'icon-pastel-teal',
  'teal-soft': 'icon-pastel-teal-soft',
  periwinkle: 'icon-pastel-periwinkle',
  'periwinkle-soft': 'icon-pastel-periwinkle-soft',
  cream: 'icon-pastel-cream',
  neutral: 'icon-pastel-neutral',
};

export interface PastelIconProps extends Omit<LucideProps, 'ref'> {
  icon: LucideIcon;
  tone?: PastelTone;
}

export const PastelIcon = React.forwardRef<SVGSVGElement, PastelIconProps>(
  ({ icon: Icon, tone = 'neutral', className, ...props }, ref) => {
    return (
      <Icon
        ref={ref}
        className={cn(toneClasses[tone], className)}
        {...props}
      />
    );
  }
);

PastelIcon.displayName = 'PastelIcon';
