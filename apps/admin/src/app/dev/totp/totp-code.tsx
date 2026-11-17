'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Shows the code handed down by the server and refreshes it just before the
 * 30-second window closes, so what is on screen is never stale.
 */
export function TotpCode({ initialSecondsLeft }: { initialSecondsLeft: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [secondsLeft, setSecondsLeft] = useState(initialSecondsLeft);

  useEffect(() => {
    const timer = setInterval(() => {
      const left = 30 - (Math.floor(Date.now() / 1000) % 30);
      setSecondsLeft(left);
      // Re-render on the server a beat after the window rolls over.
      if (left >= 29) startTransition(() => router.refresh());
    }, 1000);
    return () => clearInterval(timer);
  }, [router]);

  return <p className="text-xs text-muted-foreground">يتغيّر بعد {secondsLeft} ثانية</p>;
}
