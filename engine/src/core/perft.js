/**
 * perft — the only move-generation correctness gate that matters.
 *
 * Bulk counting at depth 1: `perft(1) == legalMoveCount`, so the leaf ply is
 * never make/unmake'd. That is a ~30× reduction in make/unmake calls and it
 * loses no coverage — every move counted at depth 1 was produced by the same
 * generator that produces the moves at depth 2+.
 *
 * Slot reuse is keyed on DEPTH, not ply. Recursion strictly decreases depth,
 * so a node's move list can never be clobbered by its own subtree.
 */
import { generateMoves, freshList } from './moveGeneration.js';

const SLOTS = [];
function slotFor(depth) {
  let s = SLOTS[depth];
  if (s === undefined) s = SLOTS[depth] = freshList();
  return s;
}

export function perft(board, depth) {
  if (depth <= 0) return 1;

  const moves = generateMoves(board, board.gameState.activeColor, slotFor(depth), false, false);
  if (depth === 1) return moves.length;

  let nodes = 0;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    board.makeMove(m.fromSquare, m.toSquare, m.promotionPiece);
    nodes += perft(board, depth - 1);
    board.undoMove();
  }
  return nodes;
}

/**
 * Per-root-move breakdown. Diff this against a reference (Qperft / stockfish
 * `go perft`) to localise a generation bug to a single move in one ply.
 */
export function perftDivide(board, depth) {
  const out = new Map();
  if (depth <= 0) return out;
  const moves = generateMoves(board, board.gameState.activeColor, freshList(), false, true);
  for (const m of moves) {
    board.makeMove(m.fromSquare, m.toSquare, m.promotionPiece);
    out.set(m.algebraic, depth === 1 ? 1 : perft(board, depth - 1));
    board.undoMove();
  }
  return out;
}

export default perft;