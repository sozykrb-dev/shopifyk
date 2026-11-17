'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldHint,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@velnorix/ui';
import {
  addStoreMemberAction,
  changeMemberRoleAction,
  setMemberStatusAction,
  type StaffFormState,
} from '@/app/actions/store-staff.js';

export type StaffRole = { key: string; nameAr: string };
export type StaffMember = {
  userId: string;
  email: string;
  fullName: string;
  roleKey: string;
  roleNameAr: string;
  status: string;
};

function SubmitButton({
  label,
  variant,
  disabled,
}: {
  label: string;
  variant?: 'default' | 'outline';
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} variant={variant} disabled={disabled}>
      {label}
    </Button>
  );
}

function ErrorLine({ state }: { state: StaffFormState }) {
  if (!state.error) return null;
  return <Alert tone="danger" title={state.error} />;
}

function OkLine({ state }: { state: StaffFormState }) {
  if (!state.ok) return null;
  return <Alert tone="success" title={state.ok} />;
}

/** Adds an existing platform user to this store. */
export function AddMemberForm({ roles }: { roles: readonly StaffRole[] }) {
  const [state, formAction] = useActionState<StaffFormState, FormData>(addStoreMemberAction, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>إضافة موظف</CardTitle>
        <CardDescription>
          يجب أن يكون للموظف حساب مستخدم بالفعل. تُمنح الصلاحيات حسب الدور المختار.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <ErrorLine state={state} />
          <OkLine state={state} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="member-email">البريد الإلكتروني</Label>
              <Input
                id="member-email"
                name="email"
                type="email"
                inputMode="email"
                dir="ltr"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-role">الدور</Label>
              <Select name="roleKey" defaultValue="support">
                <SelectTrigger id="member-role">
                  <SelectValue placeholder="اختر الدور" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.key} value={role.key}>
                      {role.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>الدور يحدد ما يمكن للموظف رؤيته وتعديله.</FieldHint>
            </div>
          </div>

          <SubmitButton label="إضافة للفريق" />
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The roster.
 *
 * `currentUserId` is passed down so the UI can disable the self-service rows
 * rather than letting the server reject them after the fact -- the action
 * still refuses, this is only sparing the user a confusing round trip.
 */
export function StaffList({
  members,
  roles,
  currentUserId,
}: {
  members: readonly StaffMember[];
  roles: readonly StaffRole[];
  currentUserId: string;
}) {
  const [roleState, roleAction] = useActionState<StaffFormState, FormData>(
    changeMemberRoleAction,
    {},
  );
  const [statusState, statusAction] = useActionState<StaffFormState, FormData>(
    setMemberStatusAction,
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>فريق المتجر</CardTitle>
        <CardDescription>
          {members.length} {members.length === 1 ? 'عضو' : 'أعضاء'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorLine state={roleState} />
        <OkLine state={roleState} />
        <ErrorLine state={statusState} />
        <OkLine state={statusState} />

        <div className="space-y-3">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            const active = member.status === 'active';

            return (
              <div
                key={member.userId}
                /*
                 * `data-self` marks the row the signed-in user cannot edit.
                 * Asserting "their own controls are disabled" from a test needs
                 * a hook that survives a class rename -- a selector built on
                 * `rounded-lg` would match the surrounding Card first.
                 */
                data-testid="staff-row"
                data-self={isSelf ? 'true' : 'false'}
                className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-end sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    {member.fullName}
                    {isSelf ? (
                      <span className="mr-2 text-xs text-muted-foreground">(أنت)</span>
                    ) : null}
                  </p>
                  <p className="numeric truncate text-sm text-muted-foreground" dir="ltr">
                    {member.email}
                  </p>
                  {!active ? <p className="text-xs text-destructive">الحساب معطّل</p> : null}
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <form action={roleAction} className="flex items-end gap-2">
                    <input type="hidden" name="userId" value={member.userId} />
                    <div className="space-y-1">
                      <Select name="roleKey" defaultValue={member.roleKey} disabled={isSelf}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((role) => (
                            <SelectItem key={role.key} value={role.key}>
                              {role.nameAr}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <SubmitButton label="تحديث" variant="outline" />
                  </form>

                  <form action={statusAction}>
                    <input type="hidden" name="userId" value={member.userId} />
                    <input type="hidden" name="active" value={active ? '0' : '1'} />
                    <SubmitButton
                      label={active ? 'تعطيل' : 'تفعيل'}
                      variant={active ? 'outline' : 'default'}
                      disabled={isSelf}
                    />
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
