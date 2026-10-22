export const fmtInt = (n) => (n === null || n === undefined || !Number.isFinite(n)) ? '–' : Math.round(n).toLocaleString();
export function fmtCp(cp, mate = null) {
  if (cp === null || cp === undefined || !Number.isFinite(cp)) return '–';
  if (mate !== null && mate !== undefined && mate !== 0) return `M${mate}`;
  if (Math.abs(cp) >= 100000) return cp > 0 ? '+∞' : '−∞';
  if (Math.abs(cp) > 49000) return cp > 0 ? 'M' : '−M';
  return (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
}
export const fmtMs = (ms) => (ms === null || ms === undefined) ? '–' : ms >= 10000 ? `${(ms / 1000).toFixed(1)}s` : `${fmtInt(ms)}ms`;
export const pct = (x, d = 0) => (x === null || x === undefined || !Number.isFinite(x)) ? '–' : `${(x * 100).toFixed(d)}%`;
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
export const PIECE_NAME = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };
export const WHY_LABEL = {
  tt: 'TT move', book: 'book hint', promo: 'promotion', 'win-capture': 'winning capture',
  'even-capture': 'even capture', 'lose-capture': 'losing capture', killer: 'killer', counter: 'counter-move', quiet: 'quiet',
};
/** Turn index → "12. …" style prefix from the half-move index. */
export function plyLabel(t) { return `${Math.floor(t / 2) + 1}${t % 2 === 0 ? '.' : '…'}`; }