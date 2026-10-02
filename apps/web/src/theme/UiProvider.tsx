import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import type { ReactNode } from 'react';
import { mantineTheme, mantineVariables } from './mantine';

// Mantine for the dialog, the select, the notifications and the tooltips (SPEC.md decision log,
// T29). Request errors go to notifications at the top right, under the 56px top bar so they
// never cover the persona switcher.
export function UiProvider({ children }: { children: ReactNode }) {
  return (
    <MantineProvider
      theme={mantineTheme}
      cssVariablesResolver={mantineVariables}
      forceColorScheme="dark"
      // Under vitest, Mantine skips its transitions so the dropdowns and dialogs open at once.
      env={import.meta.env.MODE === 'test' ? 'test' : 'default'}
    >
      <Notifications position="top-right" limit={3} className="top-16" />
      {children}
    </MantineProvider>
  );
}
