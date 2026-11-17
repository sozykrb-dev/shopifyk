'use client';

import { useEffect, useState } from 'react';
import { Languages, Moon, Sun } from 'lucide-react';
import { Button } from '@velnorix/ui';

type Mode = 'light' | 'dark';
type Direction = 'rtl' | 'ltr';

const MODE_KEY = 'velnorix.theme';
const DIR_KEY = 'velnorix.dir';

/**
 * Theme and direction controls.
 *
 * Both are stored in localStorage and applied before paint by a small inline
 * script, so a dark-mode user never sees a flash of the light theme. The
 * direction switch exists because bilingual teams work in both.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('light');

  useEffect(() => {
    setMode(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next: Mode = mode === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem(MODE_KEY, next);
    setMode(next);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={mode === 'dark' ? 'التبديل للوضع النهاري' : 'التبديل للوضع الليلي'}
      title={mode === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
    >
      {mode === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}

export function DirectionToggle() {
  const [dir, setDir] = useState<Direction>('rtl');

  useEffect(() => {
    setDir((document.documentElement.dir as Direction) ?? 'rtl');
  }, []);

  function toggle() {
    const next: Direction = dir === 'rtl' ? 'ltr' : 'rtl';
    document.documentElement.dir = next;
    document.documentElement.lang = next === 'rtl' ? 'ar' : 'en';
    localStorage.setItem(DIR_KEY, next);
    setDir(next);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="تبديل اتجاه الواجهة"
      title={dir === 'rtl' ? 'English (LTR)' : 'العربية (RTL)'}
    >
      <Languages aria-hidden="true" />
    </Button>
  );
}

/** Applies the stored theme/direction before first paint (no flash). */
export const themeBootstrapScript = `
(function () {
  try {
    var mode = localStorage.getItem('${MODE_KEY}');
    var dark = mode ? mode === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
    var dir = localStorage.getItem('${DIR_KEY}');
    if (dir) { document.documentElement.dir = dir; document.documentElement.lang = dir === 'rtl' ? 'ar' : 'en'; }
  } catch (error) { /* private mode: keep the defaults */ }
})();
`;
