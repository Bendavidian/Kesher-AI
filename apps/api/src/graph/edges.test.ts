import { describe, expect, it } from 'vitest';
import { relationshipKey, roleEdge, SEEDED_KEYS } from './edges';

describe('roleEdge', () => {
  it('maps each role to an edge read from the named company to the filer', () => {
    expect(roleEdge('NVDA', 'TSM', 'supplies_filer')).toEqual({
      from: 'TSM',
      type: 'supplier_of',
      to: 'NVDA',
    });
    expect(roleEdge('LRCX', 'MU', 'buys_from_filer')).toEqual({
      from: 'MU',
      type: 'customer_of',
      to: 'LRCX',
    });
    expect(roleEdge('AMD', 'INTC', 'competitor')).toEqual({
      from: 'INTC',
      type: 'competitor_of',
      to: 'AMD',
    });
    expect(roleEdge('NVDA', 'MSFT', 'none')).toBeNull();
  });
});

describe('relationshipKey', () => {
  it('gives one key per relationship, whichever side states it', () => {
    expect(relationshipKey({ from: 'MU', type: 'customer_of', to: 'LRCX' })).toBe(
      relationshipKey({ from: 'LRCX', type: 'supplier_of', to: 'MU' }),
    );
    expect(relationshipKey({ from: 'AMD', type: 'competitor_of', to: 'NVDA' })).toBe(
      relationshipKey({ from: 'NVDA', type: 'competitor_of', to: 'AMD' }),
    );
  });

  it('keeps supply direction and relationship type apart', () => {
    expect(relationshipKey({ from: 'TSM', type: 'supplier_of', to: 'INTC' })).not.toBe(
      relationshipKey({ from: 'INTC', type: 'supplier_of', to: 'TSM' }),
    );
    expect(relationshipKey({ from: 'TSM', type: 'supplier_of', to: 'INTC' })).not.toBe(
      relationshipKey({ from: 'TSM', type: 'competitor_of', to: 'INTC' }),
    );
  });
});

describe('SEEDED_KEYS', () => {
  it('holds the six demo edges, including LRCX supplying TSM stated as a customer', () => {
    expect(SEEDED_KEYS.size).toBe(6);
    expect(SEEDED_KEYS.has(relationshipKey({ from: 'TSM', type: 'customer_of', to: 'LRCX' }))).toBe(
      true,
    );
  });
});
