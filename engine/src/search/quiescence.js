/**
 * Quiescence search — extend captures/promotions (and all evasions when in
 * check) until the position is quiet.
 *
 * `ply` is the ABSOLUTE distance from the search root, so mate scores returned
 * here are comparable with mates found in the main tree.
 *
 * FRONTIER POLICY. Returning stand-pat the instant `qDepth == maxQDepth` cuts
 * the tree mid-exchange: the side that initiated a trade banks the victim and
 * the recapture falls beyond the horizon. Past the nominal horizon we therefore
 * keep resolving only FORCED business — check evasions, and recaptures on the
 * square that just changed hands — up to a hard wall. Everything else returns
 * stand-pat as before, so the extension is bounded and cannot blow up.
 */
import { PIECE_VALUES, PIECES, SCORE } from '../core/constants.js';
import { generateMoves, listForPly, isInCheck, moveAlgebraic } from '../core/moveGeneration.js';
import { seeFast } from './see.js';
import logger, { LOG, CAT } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;

const DELTA_MARGIN   = 200;
const DELTA_PER_MOVE = 100;
/** Plies of forced-continuation extension allowed past maxQDepth. */
const FRONTIER_EXTRA = 6;

/**
 * @param {{stopSearch:boolean}|null} abort  Stop flag owned by the caller
 *        (SearchEngine). Checked on entry so an aborted search unwinds through
 *        quiescence instead of finishing a deep capture tree first. Null in
 *        direct/test invocations.
 */
export function quiescenceSearch(
  board, alpha, beta, color, evaluator, ply = 0, qDepth = 0, maxQDepth = 8,
  lastTo = -1, abort = null
) {
  const standPat = evaluator.evaluate(board, color).score;
  // Unwind immediately: the returned value is discarded by the aborting
  // caller, so stand-pat is the cheapest sound thing to hand back.
  if (abort !== null && abort.stopSearch) return standPat;
  const inCheck = isInCheck(board, color);

  // Past the nominal horizon: only forced business, and only to a hard wall.
  const pastHorizon = qDepth >= maxQDepth;
  if (pastHorizon) {
    if (qDepth >= maxQDepth + FRONTIER_EXTRA) return standPat;
    if (!inCheck && lastTo < 0) return standPat;
  }

  if (!inCheck) {
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (standPat + PIECE_VALUES[PIECES.QUEEN] + DELTA_MARGIN < alpha) return alpha;
  }

  const oppositeColor = color === 'white' ? 'black' : 'white';
  const moves = generateMoves(board, color, listForPly(ply), true, false);

  if (moves.length === 0) {
    if (inCheck) return -(SCORE.MATE - ply);   // absolute ply
    return standPat;
  }

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    m.seeScore = m.capturedPiece !== null ? seeFast(board, m) : 0;
    m.qScore = scoreTacticalMove(m);
  }
  moves.sort((a, b) => b.qScore - a.qScore);

  if (__LOG__ && LOG.search) {
    logger.trace(CAT.SEARCH, 'qnode', {
      q: qDepth, ply, n: moves.length, top: moveAlgebraic(moves[0]),
      frontier: pastHorizon ? 1 : 0,
    });
  }

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];

    // Frontier filter: recapture on lastTo only (evasions are unrestricted).
    if (pastHorizon && !inCheck && move.toSquare !== lastTo) continue;

    if (!inCheck && move.capturedPiece !== null) {
      const maxGain = PIECE_VALUES[move.capturedPiece] +
        (move.isPromotion ? PIECE_VALUES[PIECES.QUEEN] - PIECE_VALUES[PIECES.PAWN] : 0);
      if (standPat + maxGain + DELTA_PER_MOVE < alpha) continue;
      // seeFast is now exact for materially even exchanges, so this gate no
      // longer discards a free piece whose victim happened to be cheaper than
      // the attacker, and no longer admits a defended capture as "winning".
      if (move.seeScore < 0) continue;
    }

    board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
    const nextLastTo = move.capturedPiece !== null ? move.toSquare : -1;
    const score = -quiescenceSearch(board, -beta, -alpha, oppositeColor, evaluator,
                                    ply + 1, qDepth + 1, maxQDepth, nextLastTo, abort);
    board.undoMove();

    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

function scoreTacticalMove(move) {
  let v = move.seeScore * 16;
  if (move.capturedPiece !== null) {
    v += PIECE_VALUES[move.capturedPiece] - PIECE_VALUES[move.piece] / 16;
  }
  if (move.isPromotion) v += PIECE_VALUES[move.promotionPiece ?? PIECES.QUEEN];
  return v;
}

export default quiescenceSearch;