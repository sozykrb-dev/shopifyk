import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/cn.js';

/* -------------------------------------------------------------------------- */
/* Badge                                                                       */
/* -------------------------------------------------------------------------- */

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      tone: {
        neutral: 'border-transparent bg-muted text-muted-foreground',
        primary: 'border-transparent bg-primary/10 text-primary',
        success: 'border-transparent bg-success/10 text-success',
        warning: 'border-transparent bg-warning/15 text-warning',
        danger: 'border-transparent bg-destructive/10 text-destructive',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Alert                                                                       */
/* -------------------------------------------------------------------------- */

const alertTones = {
  info: { wrapper: 'border-border bg-muted/60 text-foreground', icon: Info },
  success: {
    wrapper: 'border-success/30 bg-success/10 text-success-foreground',
    icon: CheckCircle2,
  },
  warning: {
    wrapper: 'border-warning/40 bg-warning/10 text-warning-foreground',
    icon: TriangleAlert,
  },
  danger: {
    wrapper: 'border-destructive/40 bg-destructive/10 text-destructive',
    icon: AlertCircle,
  },
} as const;

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  tone?: keyof typeof alertTones;
  title?: React.ReactNode;
};

export function Alert({ className, tone = 'info', title, children, ...props }: AlertProps) {
  const { wrapper, icon: Icon } = alertTones[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border p-4 text-sm', wrapper, className)}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        {title ? <p className="font-medium leading-none">{title}</p> : null}
        {children ? <div className="text-sm opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                    */
/* -------------------------------------------------------------------------- */

/** Loading placeholder. Announced as busy so screen readers do not read it. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/** Empty state used by every list and table in the admin. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center">
      {icon ? <div className="text-muted-foreground [&_svg]:size-8">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
