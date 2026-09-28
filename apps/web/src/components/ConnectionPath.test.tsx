import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FEED_ITEMS } from '../fixtures/demoEvent';
import { PERSONAS } from '../fixtures/personas';
import { buildPathView } from '../view/path';
import { ConnectionPath } from './ConnectionPath';

afterEach(cleanup);

function pathFor(key: 'A' | 'B' | 'C') {
  const persona = PERSONAS.find((p) => p.key === key);
  const item = FEED_ITEMS[key][0];
  if (!persona || !item) throw new Error(`missing fixture for persona ${key}`);
  return buildPathView(item.path, 'TSM', persona);
}

describe('ConnectionPath', () => {
  it('names the supplier path in its accessible label', () => {
    render(<ConnectionPath path={pathFor('A')} />);
    const path = screen.getByRole('img', {
      name: 'TSMC supplies NVIDIA, and NVIDIA is in your portfolio',
    });
    expect(path.textContent).toContain('supplies');
    expect(path.textContent).toContain('in your portfolio');
  });

  it('names a direct holding', () => {
    render(<ConnectionPath path={pathFor('B')} />);
    expect(screen.getByRole('img', { name: 'You hold TSMC directly' })).toBeTruthy();
  });

  it('names a missing path and draws it dashed', () => {
    const { container } = render(<ConnectionPath path={pathFor('C')} />);
    expect(
      screen.getByRole('img', { name: 'No connection from TSMC to your holdings' }),
    ).toBeTruthy();
    expect(container.querySelector('.border-dashed')).toBeTruthy();
  });

  it('animates only when the user allows motion', () => {
    const { container } = render(<ConnectionPath path={pathFor('A')} />);
    const classes = [...container.querySelectorAll('[class]')].flatMap((el) =>
      el.getAttribute('class')!.split(/\s+/),
    );
    const animated = classes.filter((name) => name.includes('animate-'));
    expect(animated.length).toBeGreaterThan(0);
    for (const name of animated) expect(name).toMatch(/^motion-safe:/);
  });

  it('pops stations and grows lines in sequence, left to right', () => {
    const { container } = render(<ConnectionPath path={pathFor('A')} />);
    const delays = [...container.querySelectorAll<HTMLElement>('[data-motion]')].map((el) =>
      parseInt(el.style.animationDelay, 10),
    );
    expect(delays.length).toBe(5);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
  });
});
