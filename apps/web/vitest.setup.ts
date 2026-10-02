import { notifications } from '@mantine/notifications';
import { afterEach } from 'vitest';

// What jsdom lacks and Mantine reads (T29): media queries, element sizes and scrolling.
const missing = (target: object, key: string) =>
  typeof (target as Record<string, unknown>)[key] !== 'function';

if (typeof window !== 'undefined') {
  if (missing(window, 'matchMedia')) {
    Object.assign(window, {
      matchMedia: (query: string) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    });
  }
  if (missing(window, 'ResizeObserver')) {
    Object.assign(window, {
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
  if (missing(Element.prototype, 'scrollIntoView')) {
    Object.assign(Element.prototype, { scrollIntoView() {} });
  }
}

// Mantine keeps notifications in one store for the page; each test starts with none.
afterEach(() => notifications.clean());
