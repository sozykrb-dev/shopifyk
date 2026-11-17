'use client';

import { Alert } from '@velnorix/ui';

export default function StorefrontError({ error }: { error: Error & { digest?: string } }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Alert tone="danger" title="حدث خطأ ما">
          حدث خطأ أثناء تحميل الصفحة. يرجى المحاولة مرة أخرى.
          {error.digest ? (
            <span className="block pt-2 font-mono text-xs">{error.digest}</span>
          ) : null}
        </Alert>
      </div>
    </main>
  );
}
