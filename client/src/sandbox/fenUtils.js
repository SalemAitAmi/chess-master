/**
 * Display-only FEN manipulation for the Sandbox.
 *
 * This is NOT chess logic and must never become the basis of a rule decision:
 * nothing here checks legality. It exists so a LOGGED line (a PV, a candidate)
 * can be shown from a LOGGED root FEN without a round-trip to an engine that
 * may not even be running while a session is replayed. Castling rights, the
 * e.p. square and the clocks are blanked in the result on purpose.
 */
import { parseFenToBoard } from '../utils/chessUtils';
import { PIECES } from '../constants/gameConstants';

const FILES = 'abcdefgh';
const PIECE_CHAR = {
  [PIECES.KING]: 'k', [PIECES.QUEEN]: 'q', [PIECES.ROOK]: 'r',
  [PIECES.BISHOP]: 'b', [PIECES.KNIGHT]: 'n', [PIECES.PAWN]: 'p',
};
const CHAR_PIECE = { K: 'K', Q: 'Q', R: 'R', B: 'B', N: 'N', P: 'P' };
const PIECE_LETTER = {
  [PIECES.KING]: 'K', [PIECES.QUEEN]: 'Q', [PIECES.ROOK]: 'R',
  [PIECES.BISHOP]: 'B', [PIECES.KNIGHT]: 'N', [PIECES.PAWN]: 'P',
};
const PROMO = { q: PIECES.QUEEN, r: PIECES.ROOK, b: PIECES.BISHOP, n: PIECES.KNIGHT };

export function squareToRC(sq) {
  if (typeof sq !== 'string' || sq.length < 2) return null;
  const c = FILES.indexOf(sq[0]);
  const r = 8 - parseInt(sq[1], 10);
  return (c < 0 || !(r >= 0 && r < 8)) ? null : [r, c];
}
export function rcToSquare(r, c) { return FILES[c] + (8 - r); }
export function sideToMove(fen) { return (fen || '').split(' ')[1] === 'b' ? 'black' : 'white'; }
export function moveFrom(uci) { return uci.slice(0, 2); }
export function moveTo(uci) { return uci.slice(2, 4); }

export function pieceAt(fen, sq) {
  const rc = squareToRC(sq);
  if (!rc || !fen) return null;
  return parseFenToBoard(fen)[rc[0]][rc[1]];
}
/** 'K' | 'Q' | … for the piece on a square, or null. */
export function pieceLetterAt(fen, sq) {
  const p = pieceAt(fen, sq);
  return p ? PIECE_LETTER[p.type] ?? null : null;
}
export { CHAR_PIECE };

function placementOf(board) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = '', empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) { empty++; continue; }
      if (empty > 0) { row += empty; empty = 0; }
      const ch = PIECE_CHAR[p.type];
      row += p.color === 'white' ? ch.toUpperCase() : ch;
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

export function applyUciToFen(fen, uci) {
  if (!fen || typeof uci !== 'string' || uci.length < 4) return fen;
  const from = squareToRC(uci.slice(0, 2)), to = squareToRC(uci.slice(2, 4));
  if (!from || !to) return fen;
  const board = parseFenToBoard(fen);
  const piece = board[from[0]][from[1]];
  if (!piece) return fen;
  let moved = piece;
  if (piece.type === PIECES.PAWN) {
    if (from[1] !== to[1] && board[to[0]][to[1]] === null) board[from[0]][to[1]] = null;   // e.p. victim
    if (uci.length > 4 && PROMO[uci[4]] !== undefined) moved = { type: PROMO[uci[4]], color: piece.color };
  }
  if (piece.type === PIECES.KING && Math.abs(to[1] - from[1]) === 2) {
    const rookFrom = to[1] > from[1] ? 7 : 0, rookTo = to[1] > from[1] ? 5 : 3;
    board[from[0]][rookTo] = board[from[0]][rookFrom];
    board[from[0]][rookFrom] = null;
  }
  board[to[0]][to[1]] = moved;
  board[from[0]][from[1]] = null;
  const side = sideToMove(fen) === 'white' ? 'b' : 'w';
  return `${placementOf(board)} ${side} - - 0 1`;
}

export function applyLine(fen, moves, count) {
  let f = fen;
  const n = Math.min(count, moves.length);
  for (let i = 0; i < n; i++) f = applyUciToFen(f, moves[i]);
  return f;
}