import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '../lib/cn.js';

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className,
    )}
    {...props}
  />
));
Label.displayName = 'Label';

/** Small helper text under a field: hints on the start side, errors in red. */
export function FieldHint({
  children,
  tone = 'muted',
  id,
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'error';
  id?: string;
}) {
  return (
    <p
      id={id}
      className={cn(
        'text-xs leading-relaxed',
        tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {children}
    </p>
  );
}
