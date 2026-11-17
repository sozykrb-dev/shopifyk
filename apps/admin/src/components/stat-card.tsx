import { Card } from '@velnorix/ui';
import { cn } from '@velnorix/ui';

/** One KPI tile. Numbers are rendered with Latin digits and tabular spacing. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneClasses = {
    neutral: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
  } as const;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className={cn('text-2xl font-semibold tabular numeric', toneClasses[tone])}>{value}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {icon ? <div className="text-muted-foreground [&_svg]:size-5">{icon}</div> : null}
      </div>
    </Card>
  );
}
