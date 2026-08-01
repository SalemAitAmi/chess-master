import { describe, test, expect } from 'vitest';
import { UciSession } from './harness/uciSession.js';

describe('UCI: promotion round-trip', () => {
  const PROMO_FEN = '8/P7/8/8/8/8/8/k6K w - - 0 1';

  test('validate accepts each promotion piece', async () => {
    const s = new UciSession();
    await s.setPosition(PROMO_FEN);
    for (const p of ['q', 'r', 'b', 'n']) {
      expect(await s.cmd(`validate a7a8${p}`)).toBe('valid true');
    }
  });

  test('validate reports needs_promotion for a bare promotion move', async () => {
    const s = new UciSession();
    await s.setPosition(PROMO_FEN);
    expect(await s.cmd('validate a7a8')).toBe('valid true needs_promotion');
  });

  test('validate rejects a bad promotion letter', async () => {
    const s = new UciSession();
    await s.setPosition(PROMO_FEN);
    expect(await s.cmd('validate a7a8x')).toMatch(/^valid false/);
  });

  test('validate rejects a promotion suffix on a non-promotion move', async () => {
    const s = new UciSession();
    await s.setPosition('8/8/8/8/8/8/P7/k6K w - - 0 1');
    expect(await s.cmd('validate a2a3q')).toBe('valid false unexpected_promotion');
  });

  test('legalmoves lists all four promotions and no bare variant', async () => {
    const s = new UciSession();
    await s.setPosition(PROMO_FEN);
    const res = await s.cmd('legalmoves a7');
    const moves = res.slice('legalmoves '.length).split(' ').sort();
    expect(moves).toEqual(['a7a8b', 'a7a8n', 'a7a8q', 'a7a8r']);
  });

  test('makemove applies the promotion and advances the position', async () => {
    const s = new UciSession();
    await s.setPosition(PROMO_FEN);                 // 8/P7/8/8/8/8/8/k6K w
    const st = await s.play('a7a8q');
    expect(st.fen.startsWith('Q7/8/8/8/8/8/8/k6K b')).toBe(true);
    expect(st.lastmove).toBe('a7a8q');
    // The new queen on a8 sees down the empty a-file to the black king on a1,
    // so this promotion IS check. My original expectation omitted the '+'.
    expect(st.lastmovesan).toBe('a8=Q+');
    expect(st.captured_white).toBe('none');
  });

  test('makemove returns an error prefix (never a state block) on failure', async () => {
    const s = new UciSession();
    await s.setPosition(PROMO_FEN);
    expect(await s.cmd('makemove a7a8')).toBe('error needs_promotion');
    expect(await s.cmd('makemove h1h3')).toMatch(/^error /);
    expect(await s.cmd('makemove zz99')).toMatch(/^error /);
  });

  test('undo restores the pawn and clears derived captures', async () => {
    const s = new UciSession();
    await s.setPosition('1n6/P7/8/8/8/8/8/k6K w - - 0 1');

    let st = await s.play('a7b8q');                 // capture + promote
    expect(st.captured_black).toBe('n');
    // b8 does not see a1 (not the same file, rank or diagonal), so unlike
    // a8=Q this promotion is NOT check. My original expectation had a stray '+'.
    expect(st.lastmovesan).toBe('axb8=Q');

    await s.cmd('undomove');
    st = await s.state();
    expect(st.captured_black).toBe('none');
    expect(st.fen.startsWith('1n6/P7')).toBe(true);
    expect(st.canundo).toBe(false);
  });
});

describe('UCI: derived captured pieces', () => {
  test('en passant capture is reported and survives undo', async () => {
    const s = new UciSession();
    await s.setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']);
    let st = await s.state();
    expect(st.captured_black).toBe('p');
    expect(st.lastmovesan).toBe('exd6');
    await s.cmd('undomove');
    st = await s.state();
    expect(st.captured_black).toBe('none');
  });
});