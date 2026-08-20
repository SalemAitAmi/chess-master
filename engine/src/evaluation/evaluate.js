/**
 * Evaluation orchestrator — called once per leaf / quiescence node.
 *
 * Allocation profile per evaluate() call:
 *   - LOG.eval OFF: zero allocations. Score accumulates in a local.
 *   - LOG.eval ON:  writes into reusable _breakdown / _context objects.
 *
 * Returns a shared result object; read .score immediately, don't retain.
 */

import { PIECES, WHITE_IDX, BLACK_IDX } from '../core/constants.js';
import { halfMoveCount } from '../utils/gameStage.js';
import { evaluateMaterial } from './material.js';
import { evaluateCenterControl } from './centerControl.js';
import { evaluateDevelopment } from './development.js';
import { evaluatePawnStructure } from './pawnStructure.js';
import { evaluateKingSafety } from './kingSafety.js';
import { getPSTValue } from './pieceSquareTables.js';
import logger, { LOG, CAT } from '../logging/logger.js';

// Build-time stripping guard — see search.js for explanation.
const __LOG__ = globalThis.__LOG__ ?? true;

// Phase contribution per piece type. Module-level constants so the
// old per-call `phaseWeights` object literal is gone.
const PHASE_KNIGHT = 1;
const PHASE_BISHOP = 1;
const PHASE_ROOK   = 2;
const PHASE_QUEEN  = 4;
// 4 minors×1 + 4 rooks×2 + 2 queens×4 = 4+4+8+8 = 24
const MAX_PHASE    = 24;

// Center-Manhattan-Distance: sum of file-distance-from-center and
// rank-distance-from-center, each in [0,3]. Total range [0,6].
// Precomputed so the hot path is one array lookup.
//   d/e files, 4/5 ranks → 0.  Corners → 6.
// This is the standard CMD table used in most engines' mop-up eval.
const CMD = new Int8Array(64);
for (let sq = 0; sq < 64; sq++) {
  const f = sq & 7, r = sq >> 3;
  const df = f < 4 ? 3 - f : f - 4;   // 0..3
  const dr = r < 4 ? 3 - r : r - 4;   // 0..3
  CMD[sq] = df + dr;                   // 0..6
}

// ─────────────────────────────────────────────────────────────────────────────
// Mop-up evaluation — only active in won endgames with a lone enemy king.
//
// THE BUG THIS FIXES. The endgame king PST rewards centralization: a8 = -74,
// b7 = +17. Walking the attacking king from b7 into the corner to deliver mate
// costs 91cp of PST. The old proximity term paid (14 - 2*dist) * 6, i.e. ~10cp
// per step after the endgameWeight scaling. The attacking king therefore sat in
// the centre forever while the queen shuffled, and K+Q vs K hit the ply limit.
//
// In a PURE mating endgame (lone enemy king, no pawns on the winning side) the
// attacking king's PST is not merely unhelpful, it is actively wrong — there is
// no enemy to be safe from and nothing to centralize for. So we cancel exactly
// the contribution material.js added for it, and let proximity be the only
// force acting on that king.
//
// Pawn endgames (K+P vs K) keep the old weights and keep their PST: there the
// plan is to promote, not to corral, and a 400cp corral term would outvote the
// passed-pawn PST.
// ─────────────────────────────────────────────────────────────────────────────
export function evaluateMopUp(board, color, endgameWeight, usePST = true) {
  if (endgameWeight < 0.5) return 0;

  const usIdx  = color === 'white' ? WHITE_IDX : BLACK_IDX;
  const oppIdx = usIdx ^ 1;
  const us  = board.bbPieces[usIdx];
  const opp = board.bbPieces[oppIdx];

  const ourPawns = us[PIECES.PAWN].popCount();
  const oppPawns = opp[PIECES.PAWN].popCount();

  const ourMat = us[PIECES.QUEEN].popCount()  + us[PIECES.ROOK].popCount()
               + us[PIECES.BISHOP].popCount() + us[PIECES.KNIGHT].popCount() + ourPawns;
  const oppMat = opp[PIECES.QUEEN].popCount()  + opp[PIECES.ROOK].popCount()
               + opp[PIECES.BISHOP].popCount() + opp[PIECES.KNIGHT].popCount() + oppPawns;

  let sign;
  if (oppMat === 0 && ourMat > 0)      sign = 1;
  else if (ourMat === 0 && oppMat > 0) sign = -1;
  else return 0;

  const ourKingSq = us[PIECES.KING].getLSB();
  const oppKingSq = opp[PIECES.KING].getLSB();
  if (ourKingSq < 0 || oppKingSq < 0) return 0;

  const defKingSq = sign === 1 ? oppKingSq : ourKingSq;
  const atkKingSq = sign === 1 ? ourKingSq : oppKingSq;

  // Is this a piece mate, or a promotion race?
  const pureMate = (sign === 1 ? ourPawns : oppPawns) === 0;

  // ── Edge push ── CMD 0..6, squared ×8 → 0..288cp. Quadratic so the gradient
  // steepens near the rim.
  const cmd = CMD[defKingSq];
  let edgePush = cmd * cmd * 8;

  // ── Rim bonus ── being ON the edge is qualitatively different from being
  // near it: back-rank mate patterns only work on the actual rim.
  const defF = defKingSq & 7, defR = defKingSq >> 3;
  if (defF === 0 || defF === 7 || defR === 0 || defR === 7) edgePush += 40;

  // ── King proximity ── Chebyshev, because that is literally "king moves to
  // reach". Weight 20 in a pure mate (≈33cp per step once endgameWeight is
  // applied — nothing opposes it now that the PST is cancelled); the old 6
  // elsewhere.
  const atkF = atkKingSq & 7, atkR = atkKingSq >> 3;
  const kingDist = Math.max(Math.abs(atkF - defF), Math.abs(atkR - defR));
  const proximity = Math.max(0, 14 - 2 * kingDist) * (pureMate ? 20 : 6);

  let score = sign * Math.round((edgePush + proximity) * endgameWeight);

  if (pureMate && usePST) {
    // material.js added `sign * PST(atkKing)` to this evaluation (ourPST when
    // the attacker is `color`, -theirPST when it is the opponent). Undo it.
    const atkIsWhite = (sign === 1) === (color === 'white');
    score -= sign * getPSTValue(PIECES.KING, atkKingSq, atkIsWhite, 1 - endgameWeight);
  }

  return score;
}

export class Evaluator {
  constructor(config = {}) {
    const w = config.weights || {};
    this.config = {
      useMaterial:      config.useMaterial      !== false,
      useCenterControl: config.useCenterControl !== false,
      useDevelopment:   config.useDevelopment   !== false,
      usePawnStructure: config.usePawnStructure !== false,
      useKingSafety:    config.useKingSafety    !== false,
      weights: {
        material:      w.material ?? 1.0,
        centerControl: w.centerControl ?? 1.0,
        development:   w.development ?? 1.0,
        pawnStructure: w.pawnStructure ?? 1.0,
        kingSafety:    w.kingSafety ?? 1.0,
      },
    };

    // ── Reusable output objects ──
    // evaluate() writes into these instead of allocating per call. Safe
    // because eval is synchronous and callers read .score immediately
    // (search.js does `evaluator.evaluate(...).score` inline).
    this._result    = { score: 0, breakdown: null, context: null };
    this._breakdown = { material: 0, centerControl: 0, development: 0, pawnStructure: 0, kingSafety: 0, mopUp: 0 };
    this._context   = { phase: 0, gamePhase: 0, endgameWeight: 0, moveCount: 0 };
  }

  /**
   * Raw phase: sum of piece-type weights over remaining material.
   * Pure arithmetic + popCount; no allocation.
   */
  _computePhase(board) {
    const wp = board.bbPieces[WHITE_IDX];
    const bp = board.bbPieces[BLACK_IDX];
    return (wp[PIECES.KNIGHT].popCount() + bp[PIECES.KNIGHT].popCount()) * PHASE_KNIGHT
         + (wp[PIECES.BISHOP].popCount() + bp[PIECES.BISHOP].popCount()) * PHASE_BISHOP
         + (wp[PIECES.ROOK  ].popCount() + bp[PIECES.ROOK  ].popCount()) * PHASE_ROOK
         + (wp[PIECES.QUEEN ].popCount() + bp[PIECES.QUEEN ].popCount()) * PHASE_QUEEN;
  }

  /**
   * Evaluate from `color`'s perspective.
   * Returns the shared _result — read fields immediately, don't hold.
   */
    evaluate(board, color) {
    const cfg = this.config;
    const w = cfg.weights;

    const phase = this._computePhase(board);
    const gamePhase = phase >= MAX_PHASE ? 1 : phase / MAX_PHASE;
    const endgameWeight = 1 - gamePhase;
    const moveCount = board.plyCount;

    const wantBreakdown = __LOG__ && LOG.eval;
    const bd = wantBreakdown ? this._breakdown : null;

    let score = 0;
    score += this._evalMaterial(board, color, w, gamePhase, bd);
    score += this._evalCenterControl(board, color, w, gamePhase, bd);
    score += this._evalDevelopment(board, color, w, moveCount, bd);
    score += this._evalPawnStructure(board, color, w, bd);
    score += this._evalKingSafety(board, color, w, endgameWeight, bd);
    score += this._evalMopUp(board, color, endgameWeight, bd);

    if (wantBreakdown) {
      this._logLeafEval(score, gamePhase, bd);
    }

    return this._buildResult(score, wantBreakdown, bd, phase, gamePhase, endgameWeight, moveCount);
  }

  _evalMaterial(board, color, w, gamePhase, bd) {
    if (!this.config.useMaterial) return 0;
    const s = evaluateMaterial(board, color, w.material, gamePhase);
    if (bd) bd.material = s;
    return s;
  }

  _evalCenterControl(board, color, w, gamePhase, bd) {
    if (!this.config.useCenterControl) return 0;
    const s = evaluateCenterControl(board, color, w.centerControl * (0.5 + 0.5 * gamePhase));
    if (bd) bd.centerControl = s;
    return s;
  }

  _evalDevelopment(board, color, w, moveCount, bd) {
    if (!this.config.useDevelopment) return 0;
    const s = evaluateDevelopment(board, color, moveCount, w.development);
    if (bd) bd.development = s;
    return s;
  }

  _evalPawnStructure(board, color, w, bd) {
    if (!this.config.usePawnStructure) return 0;
    const s = evaluatePawnStructure(board, color, w.pawnStructure);
    if (bd) bd.pawnStructure = s;
    return s;
  }

  _evalKingSafety(board, color, w, endgameWeight, bd) {
    if (!this.config.useKingSafety) return 0;
    const s = evaluateKingSafety(board, color, endgameWeight, w.kingSafety);
    if (bd) bd.kingSafety = s;
    return s;
  }

  _evalMopUp(board, color, endgameWeight, bd) {
    const s = evaluateMopUp(board, color, endgameWeight, this.config.useMaterial);
    if (bd) bd.mopUp = s;
    return s;
  }

  _logLeafEval(score, gamePhase, bd) {
    logger.trace(CAT.EVAL, 'leaf', { s: score, ph: gamePhase, ...bd });
  }

  _buildResult(score, wantBreakdown, bd, phase, gamePhase, endgameWeight, moveCount) {
    const r = this._result;
    r.score = score;

    if (wantBreakdown) {
      const ctx = this._context;
      ctx.phase = phase;
      ctx.gamePhase = gamePhase;
      ctx.endgameWeight = endgameWeight;
      ctx.moveCount = moveCount;
      r.breakdown = bd;
      r.context = ctx;
    } else {
      r.breakdown = null;
      r.context = null;
    }
    return r;
  }

  // ───────── Config mutation — rare, unguarded logging is fine ─────────

  setHeuristic(name, enabled) {
    const key = 'use' + name.charAt(0).toUpperCase() + name.slice(1);
    if (key in this.config) {
      this.config[key] = enabled;
      if (__LOG__ && LOG.eval) logger.event(CAT.EVAL, 'config', { heuristic: name, enabled });
    }
  }

  setWeight(name, weight) {
    if (name in this.config.weights) {
      this.config.weights[name] = weight;
      if (__LOG__ && LOG.eval) logger.event(CAT.EVAL, 'config', { heuristic: name, weight });
    }
  }
}

export default Evaluator;