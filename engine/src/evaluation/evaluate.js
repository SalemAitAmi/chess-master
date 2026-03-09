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
    this._breakdown = { material: 0, centerControl: 0, development: 0, pawnStructure: 0, kingSafety: 0 };
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