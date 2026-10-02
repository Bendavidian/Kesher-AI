import { notifications } from '@mantine/notifications';

// A request that failed, as a Mantine notification (SPEC.md decision log, T29). Its root has
// role="alert", so a screen reader reads it at once. Neutral, never red: red means down or
// removed (docs/UI.md).
export function notifyError(message: string): void {
  notifications.show({
    message,
    autoClose: 8000,
    closeButtonProps: { 'aria-label': 'Dismiss' },
    classNames: {
      root: 'rounded-panel border border-border-strong bg-panel py-3 pl-4 before:hidden',
      description: 'text-[13px] leading-normal text-text',
      closeButton: 'size-11 text-text-2 hover:bg-raised',
    },
  });
}

// The message of a failed request, or what failed when it has none.
export const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;
