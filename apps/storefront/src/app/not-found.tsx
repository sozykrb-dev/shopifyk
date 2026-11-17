import { Card, CardContent } from '@velnorix/ui';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-2 p-6 text-center">
          <p className="text-lg font-semibold">الصفحة غير موجودة</p>
          <p className="text-sm text-muted-foreground">ربما تم نقل الصفحة أو أن الرابط غير صحيح.</p>
        </CardContent>
      </Card>
    </main>
  );
}
