'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Badge, Button } from '@velnorix/ui';
import {
  restoreStoreAction,
  suspendStoreAction,
  type ActionState,
} from '@/app/actions/platform.js';

type StoreRow = {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'closed';
  planKey: string;
  createdAt: string;
};

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" loading={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * Row actions for one store.
 *
 * The buttons are rendered based on the signed-in user's permissions, and the
 * server action re-checks the same permission before touching the row.
 */
export function StoreActions({ store, canSuspend }: { store: StoreRow; canSuspend: boolean }) {
  const [suspendState, suspendFormAction] = useActionState<ActionState, FormData>(
    suspendStoreAction,
    {},
  );
  const [restoreState, restoreFormAction] = useActionState<ActionState, FormData>(
    restoreStoreAction,
    {},
  );
  const error = suspendState.error ?? restoreState.error;

  if (!canSuspend) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      {store.status === 'suspended' ? (
        <form action={restoreFormAction}>
          <input type="hidden" name="storeId" value={store.id} />
          <SubmitButton label="استعادة" pendingLabel="جارٍ الاستعادة…" />
        </form>
      ) : (
        <form action={suspendFormAction}>
          <input type="hidden" name="storeId" value={store.id} />
          <input type="hidden" name="reason" value="تم الإيقاف من لوحة المنصة" />
          <SubmitButton label="إيقاف" pendingLabel="جارٍ الإيقاف…" />
        </form>
      )}
    </div>
  );
}

export function StoreStatusBadge({ status }: { status: StoreRow['status'] }) {
  const tone = status === 'active' ? 'success' : status === 'suspended' ? 'danger' : 'neutral';
  const label = status === 'active' ? 'نشط' : status === 'suspended' ? 'موقوف' : 'مغلق';
  return <Badge tone={tone}>{label}</Badge>;
}
