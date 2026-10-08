import { describe, it, expect } from 'vitest';
import { SharedTranspositionTable } from '../src/search/lazySMP.js';
import { selectResult } from '../src/search/smpCoordinator.js';
import { TT_FLAG } from '../src/tables/transposition.js';
import { UCIHandler } from '../src/uci/uciHandler.js';
import { getOrCreateSession } from '../src/uci/engineSession.js';
const MOVE = { fromSquare: 12, toSquare: 28, promotionPiece: null };
describe('SharedTranspositionTable', () => {
  it('round-trips an entry', () => {
    const tt = new SharedTranspositionTable({ sizeMB: 1 });
    tt.advanceAge(); tt.newSearch();
    const key = 0x123456789abcdef0n;
    tt.store(key, 5, 42, TT_FLAG.EXACT, MOVE);
    const r = tt.probe(key, 5, -100, 100);
    expect(r.hit).toBe(true);
    expect(r.usable).toBe(true);
    expect(r.score).toBe(42);
    expect(tt.getBestMove(key)).toBe(12 | (28 << 6));
  });
  it('a torn entry reads as a miss, never a wrong score', () => {
    const tt = new SharedTranspositionTable({ sizeMB: 1 });
    tt.advanceAge(); tt.newSearch();
    const key = 0x0fedcba987654321n;
    tt.store(key, 6, 77, TT_FLAG.EXACT, MOVE);
    const lo = Number(key & 0xFFFFFFFFn) | 0;
    const base = (lo & tt.indexMask) << 2;
    tt.view[base + 3] ^= (1 << 16);            // flip a depth bit without re-folding the check
    expect(tt.probe(key, 1, -100, 100).hit).toBe(false);
    expect(tt.tornSuspect).toBeGreaterThan(0);
  });
  it('a helper view over the same buffers sees the owner\'s stores', () => {
    const owner = new SharedTranspositionTable({ sizeMB: 1 });
    owner.advanceAge(); owner.newSearch();
    const view = new SharedTranspositionTable({
      ttBuffer: owner.buffer, ctrlBuffer: owner.ctrlBuffer, serial: owner.serial, role: 'helper',
    });
    view.newSearch();
    owner.store(0xabcn << 40n, 4, -13, TT_FLAG.LOWER_BOUND, MOVE);
    expect(view.probe(0xabcn << 40n, 4, -100, -50).usable).toBe(true);
    expect(view.id).toBe(owner.id);
    expect(() => view.clear()).toThrow();
  });
});
describe('table identity and instance isolation', () => {
  it('identical configs get distinct tables and distinct ids', () => {
    const s = getOrCreateSession(`tt-id-${Date.now()}`);
    const a = s.register('A', 'baseline');
    const b = s.register('B', 'baseline');
    expect(a.handler.engine.tt).not.toBe(b.handler.engine.tt);
    expect(a.ttId()).not.toBe(b.ttId());
    s.unregister('A'); s.unregister('B');
  });
  it('a duplicate name gets its own instance, never the live one', () => {
    const s = getOrCreateSession(`dup-${Date.now()}`);
    const a = s.register('e0', 'baseline');
    const b = s.register('e0', 'baseline');
    expect(b).not.toBe(a);
    expect(b.name).toBe('e0.2');
    expect(b.handler.board).not.toBe(a.handler.board);
    s.unregister(a.name); s.unregister(b.name);
  });
  it('refuses to attach a table owned by another instance', () => {
    const a = new UCIHandler({ owner: 'x/A', options: { OwnBook: false } });
    const b = new UCIHandler({ owner: 'x/B', options: { OwnBook: false } });
    expect(() => b.engine.attachTable(a.engine.tt)).toThrow(/owned by x\/A/);
    a.quit(); b.quit();
  });
});
describe('selectResult', () => {
  const main = { depth: 6, score: 20, move: 'e2e4' };
  it('keeps main on equal depth', () => {
    expect(selectResult(main, [{ w: 1, depth: 6, score: 90, move: 'd2d4' }]).thread).toBe(0);
  });
  it('prefers a deeper helper', () => {
    expect(selectResult(main, [{ w: 2, depth: 7, score: -5, move: 'd2d4' }])).toMatchObject({ thread: 2, reason: 'deeper' });
  });
  it('prefers a proven mate', () => {
    expect(selectResult(main, [{ w: 1, depth: 5, score: 49990, move: 'h5f7' }]).reason).toBe('mate');
  });
});
describe('Lazy SMP end to end', () => {
  it('Threads 2 returns a legal bestmove', async () => {
    const h = new UCIHandler({ options: { OwnBook: false, Threads: 2 } });
    const out = await h.handleCommand('go depth 4');
    const best = out.split('\n').find(l => l.startsWith('bestmove')).split(' ')[1];
    expect(h.getLegalMoves().split(' ')).toContain(best);
    h.quit();
  }, 30000);
});