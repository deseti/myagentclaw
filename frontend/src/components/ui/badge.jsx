import * as React from 'react';
import { cn } from '@/lib/utils';

const Badge = React.forwardRef(({ className, variant = 'default', ...props }, ref) => {
  const variants = {
    default: 'bg-primary/20 text-primary border-primary/30',
    secondary: 'bg-secondary text-secondary-foreground',
    destructive: 'bg-destructive/20 text-destructive border-destructive/30',
    outline: 'border border-border text-foreground',
    success: 'bg-green-500/20 text-green-400 border-green-500/30',
    warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  };
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
        variants[variant] ?? variants.default,
        className
      )}
      {...props}
    />
  );
});
Badge.displayName = 'Badge';

export { Badge };
