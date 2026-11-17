/**
 * Display-only FEN manipulation for the Sandbox.
 *
 * This is NOT chess logic and must never become the basis of a rule decision:
 * nothing here checks legality. It exists so a LOGGED line (a PV, a candidate)
 * can be shown from a LOGGED root FEN without a round-trip to an engine that
 * may not even be running while a session is replayed. Castling rights, the
 * e.p. square and the clocks are blanked in the result on purpose.
 */
import { parseFenToBoard, squareToRowCol } from '../utils/chessUtils';
import { PIECES, PIECE_LETTERS } from '../constants/gameConstants';

const PROMO = { q: PIECES.QUEEN, r: PIECES.ROOK, b: PIECES.BISHOP, n: PIECES.KNIGHT };

export function sideToMove(fen) { return (fen || '').split(' ')[1] === 'b' ? 'black' : 'white'; }

/** Piece {type, color} on a square of a FEN, or null. */
export function pieceAt(fen, sq) {
  const rc = squareToRowCol(sq);
  if (!rc || !fen) return null;
  return parseFenToBoard(fen)[rc[0]][rc[1]];
}

/** 'K' | 'Q' | … for the piece on a square, or null. */
export function pieceLetterAt(fen, sq) {
  const p = pieceAt(fen, sq);
  return p ? PIECE_LETTERS[p.type] ?? null : null;
}

/** 8×8 board → FEN placement field. */
function placementOf(board) {
  return board.map(row => {
    let out = '', empty = 0;
    for (const p of row) {
      if (!p) { empty++; continue; }
      if (empty > 0) { out += empty; empty = 0; }
      const ch = PIECE_LETTERS[p.type];
      out += p.color === 'white' ? ch : ch.toLowerCase();
    }
    return empty > 0 ? out + empty : out;
  }).join('/');
}

/**
 * Apply one UCI move for DISPLAY. Handles the special moves' side effects
 * (e.p. victim, promotion piece, castling rook) so the picture is right;
 * unknown or malformed moves return the FEN unchanged.
 */
export function applyUciToFen(fen, uci) {
  if (!fen || typeof uci !== 'string' || uci.length < 4) return fen;
  const from = squareToRowCol(uci.slice(0, 2));
  const to = squareToRowCol(uci.slice(2, 4));
  if (!from || !to) return fen;
  const board = parseFenToBoard(fen);
  const piece = board[from[0]][from[1]];
  if (!piece) return fen;

  let moved = piece;
  if (piece.type === PIECES.PAWN) {
    // Diagonal pawn move onto an empty square can only be e.p.: remove the victim.
    if (from[1] !== to[1] && board[to[0]][to[1]] === null) board[from[0]][to[1]] = null;
    if (uci.length > 4 && PROMO[uci[4]] !== undefined) moved = { type: PROMO[uci[4]], color: piece.color };
  }
  if (piece.type === PIECES.KING && Math.abs(to[1] - from[1]) === 2) {
    const rookFrom = to[1] > from[1] ? 7 : 0, rookTo = to[1] > from[1] ? 5 : 3;
    board[from[0]][rookTo] = board[from[0]][rookFrom];
    board[from[0]][rookFrom] = null;
  }
  board[to[0]][to[1]] = moved;
  board[from[0]][from[1]] = null;
  return `${placementOf(board)} ${sideToMove(fen) === 'white' ? 'b' : 'w'} - - 0 1`;
}

/** Apply the first `count` moves of a line. */
export function applyLine(fen, moves, count) {
  let f = fen;
  for (let i = 0; i < Math.min(count, moves.length); i++) f = applyUciToFen(f, moves[i]);
  return f;
}