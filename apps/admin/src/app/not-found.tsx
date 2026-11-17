import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>الصفحة غير موجودة</CardTitle>
          <CardDescription>ربما تم نقل الصفحة أو أن الرابط غير صحيح.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
            العودة للوحة التحكم
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
