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
import { evaluateMaterial } from './material.js';
import { evaluateCenterControl } from './centerControl.js';
import { evaluateDevelopment } from './development.js';
import { evaluatePawnStructure } from './pawnStructure.js';
import { evaluateKingSafety } from './kingSafety.js';
import logger, { LOG } from '../logging/logger.js';

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
// Mop-up evaluation — only active in won endgames with lone enemy king.
//
// Two terms, both bounded and cheap:
//   1. Enemy-king centralization penalty: push the defending king toward
//      the rim. Uses Chebyshev distance from center (0 at d4/d5/e4/e5,
//      max 3 at corners). Squared so the gradient steepens near the edge —
//      the engine shouldn't be satisfied with "sort of near the edge."
//   2. King proximity bonus: bring our king close. Manhattan distance,
//      inverted. Without this the attacking king idles while the rook
//      shuffles — which is exactly the Colosseum symptom.
//
// Weighted by endgameWeight so it's silent in the middlegame and doesn't
// distort normal play. Magnitudes chosen so the combined term tops out
// around ±150cp — enough to break ties between equivalent rook squares,
// not enough to override real material/tactical considerations.
// ─────────────────────────────────────────────────────────────────────────────
function evaluateMopUp(board, color, endgameWeight) {
  if (endgameWeight < 0.5) return 0;

  const usIdx  = color === 'white' ? WHITE_IDX : BLACK_IDX;
  const oppIdx = usIdx ^ 1;
  const us  = board.bbPieces[usIdx];
  const opp = board.bbPieces[oppIdx];

  // popCount on six bitboards per side. ~12 cheap ops; fine for a term
  // that's gated behind endgameWeight >= 0.5.
  const ourMat = us[PIECES.QUEEN].popCount()  + us[PIECES.ROOK].popCount()
               + us[PIECES.BISHOP].popCount() + us[PIECES.KNIGHT].popCount()
               + us[PIECES.PAWN].popCount();
  const oppMat = opp[PIECES.QUEEN].popCount()  + opp[PIECES.ROOK].popCount()
               + opp[PIECES.BISHOP].popCount() + opp[PIECES.KNIGHT].popCount()
               + opp[PIECES.PAWN].popCount();

  let sign;
  if (oppMat === 0 && ourMat > 0)      sign = 1;
  else if (ourMat === 0 && oppMat > 0) sign = -1;
  else return 0;

  const ourKingSq = us[PIECES.KING].getLSB();
  const oppKingSq = opp[PIECES.KING].getLSB();
  if (ourKingSq < 0 || oppKingSq < 0) return 0;

  // Defender = the lone king. That's who we're pushing.
  const defKingSq = sign === 1 ? oppKingSq : ourKingSq;
  const atkKingSq = sign === 1 ? ourKingSq : oppKingSq;

  // ── Edge push ──
  // CMD gives 0..6. Quadratic scaling: 0,1,4,9,16,25,36 → ×8 = 0..288cp.
  // The ×8 multiplier was tuned so the KRK test mates in budget at depth 5
  // without the term dominating middlegame-ish endgames (K+2P vs K+P etc.,
  // which don't hit this branch anyway since neither side is a lone king).
  const cmd = CMD[defKingSq];
  let edgePush = cmd * cmd * 8;

  // ── Rim bonus ──
  // Being on the edge (any rank-0/7 or file-0/7 square) is qualitatively
  // different from being NEAR the edge — back-rank mate patterns only
  // work on the actual rim. +40 flat. This is what finally convinces the
  // engine that Ka1 is meaningfully worse for black than Kb2, even though
  // CMD(a1)=6 and CMD(b2)=4 already differ.
  const defF = defKingSq & 7, defR = defKingSq >> 3;
  if (defF === 0 || defF === 7 || defR === 0 || defR === 7) {
    edgePush += 40;
  }

  // ── King proximity ──
  // Chebyshev distance (king-move distance) between the two kings.
  // Range [1,7] in practice (kings can't touch). 14 - 2×dist rewards
  // closeness: dist 1 → 12, dist 7 → 0. ×6 → 0..72cp.
  //
  // Bumped from the previous ×4 Manhattan version. The KRK trace showed
  // white's king sitting on c3/c2/d3 for several moves while the rook
  // shuffled — proximity was too weak to pull the king in. Chebyshev is
  // the right metric here because it's literally "king moves to reach."
  const atkF = atkKingSq & 7, atkR = atkKingSq >> 3;
  const kingDist = Math.max(Math.abs(atkF - defF), Math.abs(atkR - defR));
  const proximity = Math.max(0, 14 - 2 * kingDist) * 6;

  // endgameWeight scaling stays: at 0.5 the whole term halves, at 1.0 full.
  // In pure KRK, phase is 2 (one rook), gamePhase = 2/24, endgameWeight ≈ 0.92.
  return sign * Math.round((edgePush + proximity) * endgameWeight);
}

export class Evaluator {
  constructor(config = {}) {
    this.config = {
      useMaterial:      config.useMaterial      !== false,
      useCenterControl: config.useCenterControl !== false,
      useDevelopment:   config.useDevelopment   !== false,
      usePawnStructure: config.usePawnStructure !== false,
      useKingSafety:    config.useKingSafety    !== false,
      weights: {
        material:      config.weights?.material      ?? 1.0,
        centerControl: config.weights?.centerControl ?? 1.0,
        development:   config.weights?.development   ?? 1.0,
        pawnStructure: config.weights?.pawnStructure ?? 1.0,
        kingSafety:    config.weights?.kingSafety    ?? 1.0,
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

    // ── Phase scalars — no context object unless logging wants one ──
    const phase = this._computePhase(board);
    const gamePhase = phase >= MAX_PHASE ? 1 : phase / MAX_PHASE;   // 1=mg, 0=eg
    const endgameWeight = 1 - gamePhase;

    // Replaces `board.moveHistory?.length`. plyCount is the undo-stack depth.
    // NOTE: during search this includes search plies, not just game plies —
    // same behavior as the old moveHistory.length. Development bonus tapers
    // a few plies early at high search depths. Pre-existing; fix later if
    // it shows up in test results.
    const moveCount = board.plyCount;

    // ── Decide once whether we're producing a breakdown ──
    // When eval logging is off, every `if (bd)` below is a null check that
    // branch-predicts perfectly. The breakdown object is never touched.
    const wantBreakdown = __LOG__ && LOG.eval;
    const bd = wantBreakdown ? this._breakdown : null;

    let score = 0;

    // ── Heuristic accumulation ──
    // Each block: compute, add, conditionally record. No intermediate objects.

    if (cfg.useMaterial) {
      const s = evaluateMaterial(board, color, w.material, gamePhase);
      score += s;
      if (bd) bd.material = s;
    }

    if (cfg.useCenterControl) {
      // Center matters less as pieces come off. Interpolate the weight.
      const s = evaluateCenterControl(board, color, w.centerControl * (0.5 + 0.5 * gamePhase));
      score += s;
      if (bd) bd.centerControl = s;
    }

    if (cfg.useDevelopment) {
      const s = evaluateDevelopment(board, color, moveCount, w.development);
      score += s;
      if (bd) bd.development = s;
    }

    if (cfg.usePawnStructure) {
      const s = evaluatePawnStructure(board, color, w.pawnStructure);
      score += s;
      if (bd) bd.pawnStructure = s;
    }

    if (cfg.useKingSafety) {
      const s = evaluateKingSafety(board, color, endgameWeight, w.kingSafety);
      score += s;
      if (bd) bd.kingSafety = s;
    }

    // Mop-up: breaks the "all rook squares look equal" plateau in won endgames.
    // Not gated behind a config flag because it's self-gating (returns 0 unless
    // one side is a lone king) and we always want it when applicable.
    {
      const s = evaluateMopUp(board, color, endgameWeight);
      score += s;
      if (bd) bd.mopUp = s;
    }

    // ── Trace — sampled inside evalPoint; toFen() is NOT called here.
    //    The old code called board.toFen() twice per eval regardless of
    //    log state. toFen() walks 64 squares and builds a ~80-char string. ──
    if (wantBreakdown) {
      logger.evalPoint(score, gamePhase);
    }

    // ── Populate shared result ──
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
      // Clear so stale references from a prior logged eval don't leak through.
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
      if (LOG.eval) logger.eval('info', { heuristic: name, enabled }, `${name} ${enabled ? 'on' : 'off'}`);
    }
  }

  setWeight(name, weight) {
    if (name in this.config.weights) {
      this.config.weights[name] = weight;
      if (LOG.eval) logger.eval('info', { heuristic: name, weight }, `${name} weight=${weight}`);
    }
  }
}

export default Evaluator;