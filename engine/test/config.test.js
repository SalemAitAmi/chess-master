import { describe, it, expect } from 'vitest';
import { ConfigState, formatProfileLines, DEFAULT_CONFIG } from '../src/config/index.js';
describe('ConfigState', () => {
  it('a profile is defaults + delta, in wire units', () => {
    const s = new ConfigState('tactical');
    expect(s.get('QuiescenceDepth')).toBe(10);
    expect(s.get('UsePVS')).toBe(true);
    expect(s.engineConfig().weights.initiative).toBe(1.25);
  });
  it('batches are atomic', () => {
    const s = new ConfigState('baseline');
    const h = s.hash;
    expect(s.apply([['QuiescenceDepth', '12'], ['NoSuchOption', '1']]).ok).toBe(false);
    expect(s.get('QuiescenceDepth')).toBe(8);
    expect(s.hash).toBe(h);
    const r = s.apply([['QuiescenceDepth', '12']]);
    expect(r.ok && r.identityChanged).toBe(true);
    expect(s.overrides()).toEqual({ QuiescenceDepth: 12 });
  });
  it('Profile reloads; runtime options survive and are not hashed', () => {
    const s = new ConfigState('baseline', { LogMask: 8191 });
    s.apply([['QuiescenceDepth', '12']]);
    const h = s.hash;
    s.apply([['LogMask', '0']]);
    expect(s.hash).toBe(h);
    s.apply([['Profile', 'greedy']]);
    expect(s.overrides()).toEqual({});
    expect(s.get('LogMask')).toBe(0);
  });
  it('clamps and echoes the effective value; 0 is a real value', () => {
    const s = new ConfigState();
    expect(s.apply([['Hash', '99999']]).effective).toEqual([['Hash', 1024]]);
    s.apply([['QuiescenceDepth', '0']]);
    expect(s.engineConfig().quiescenceDepth).toBe(0);
    expect(DEFAULT_CONFIG.quiescenceDepth).toBe(8);
  });
  it('profile lines are parseable', () => {
    for (const l of formatProfileLines()) expect(l).toMatch(/^profile \S+ label \S+ set .* desc /);
  });
});