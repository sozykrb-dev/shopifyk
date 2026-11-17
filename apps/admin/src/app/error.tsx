'use client';

import { useEffect } from 'react';
import { Alert, Button } from '@velnorix/ui';

export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reported through the instrumentation hook (Sentry) when one is configured.
    console.error(error);
  }, [error]);

  return (
    <div className="p-6">
      <Alert tone="danger" title="حدث خطأ غير متوقع">
        <p className="mb-3">
          لم نتمكن من إتمام هذه العملية. تم تسجيل الخطأ ويمكنك المحاولة مرة أخرى.
        </p>
        {error.digest ? <p className="mb-3 font-mono text-xs">رقم المرجع: {error.digest}</p> : null}
        <Button size="sm" variant="outline" onClick={reset}>
          إعادة المحاولة
        </Button>
      </Alert>
    </div>
  );
}
