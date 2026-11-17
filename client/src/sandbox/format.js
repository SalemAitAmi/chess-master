/** Number/score formatting for the Sandbox. Every formatter renders missing data as '–'. */
import { MATE_THRESHOLD } from '../constants/gameConstants';

export { capitalize as cap } from '../utils/text';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

export const fmtInt = (n) => (isNum(n) ? Math.round(n).toLocaleString() : '–');

/** Centipawns → "+1.25"; mate scores → "M3" (with distance) or "M"; infinities → ±∞. */
export function fmtCp(cp, mate = null) {
  if (!isNum(cp)) return '–';
  if (mate !== null && mate !== undefined && mate !== 0) return `M${mate}`;
  if (Math.abs(cp) >= 100000) return cp > 0 ? '+∞' : '−∞';
  if (Math.abs(cp) > MATE_THRESHOLD) return cp > 0 ? 'M' : '−M';
  return (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
}

export const fmtMs = (ms) => (ms === null || ms === undefined) ? '–' : ms >= 10000 ? `${(ms / 1000).toFixed(1)}s` : `${fmtInt(ms)}ms`;

export const pct = (x, d = 0) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : '–');

/** `root-move.why` → readable ordering tier. */
export const WHY_LABEL = {
  tt: 'TT move', book: 'book hint', promo: 'promotion', 'win-capture': 'winning capture',
  'even-capture': 'even capture', 'lose-capture': 'losing capture', killer: 'killer',
  counter: 'counter-move', quiet: 'quiet',
};

/** Half-move index → "12." (white) / "12…" (black). */
export function plyLabel(t) { return `${Math.floor(t / 2) + 1}${t % 2 === 0 ? '.' : '…'}`; }