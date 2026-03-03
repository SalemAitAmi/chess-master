/**
 * Main evaluation orchestrator - combines all heuristics
 */

import { PIECES } from '../core/constants.js';
import { colorToIndex } from '../core/bitboard.js';
import { evaluateMaterial } from './material.js';
import { evaluateCenterControl } from './centerControl.js';
import { evaluateDevelopment } from './development.js';
import { evaluatePawnStructure } from './pawnStructure.js';
import { evaluateKingSafety } from './kingSafety.js';
import logger from '../logging/logger.js';

export class Evaluator {
  constructor(config = {}) {
    this.config = {
      useMaterial: config.useMaterial !== false,
      useCenterControl: config.useCenterControl !== false,
      useDevelopment: config.useDevelopment !== false,
      usePawnStructure: config.usePawnStructure !== false,
      useKingSafety: config.useKingSafety !== false,
      weights: {
        material: config.weights?.material ?? 1.0,
        centerControl: config.weights?.centerControl ?? 1.0,
        development: config.weights?.development ?? 1.0,
        pawnStructure: config.weights?.pawnStructure ?? 1.0,
        kingSafety: config.weights?.kingSafety ?? 1.0
      }
    };
    
    logger.eval('info', { config: this.config }, 'Evaluator initialized');
  }

  /**
   * Calculate game context (phase, move count, etc.)
   */
  getContext(board) {
    const whiteIdx = colorToIndex('white');
    const blackIdx = colorToIndex('black');
    
    // Calculate game phase based on remaining material
    // Max phase = 24 (4 knights/bishops + 4 rooks + 2 queens = 4*1 + 4*2 + 2*4 = 24)
    let phase = 0;
    const phaseWeights = { 
      [PIECES.KNIGHT]: 1, 
      [PIECES.BISHOP]: 1, 
      [PIECES.ROOK]: 2, 
      [PIECES.QUEEN]: 4 
    };
    
    for (const pieceType of [PIECES.KNIGHT, PIECES.BISHOP, PIECES.ROOK, PIECES.QUEEN]) {
      const count = board.bbPieces[whiteIdx][pieceType].popCount() +
                   board.bbPieces[blackIdx][pieceType].popCount();
      phase += count * phaseWeights[pieceType];
    }
    
    const maxPhase = 24;
    // gamePhase: 1 = pure middlegame, 0 = pure endgame
    const gamePhase = Math.min(1, phase / maxPhase);
    const endgameWeight = 1 - gamePhase;
    const moveCount = board.moveHistory?.length || 0;
    
    logger.eval('trace', {
      phase,
      maxPhase,
      gamePhase: gamePhase.toFixed(3),
      endgameWeight: endgameWeight.toFixed(3),
      moveCount
    }, `Game context: phase=${gamePhase.toFixed(2)}, moves=${moveCount}`);
    
    return { phase, gamePhase, endgameWeight, moveCount };
  }

  /**
   * Evaluate a position from the perspective of the given color
   * @param {Board} board - Board to evaluate
   * @param {string} color - Color to evaluate for
   * @returns {Object} Evaluation result with score and breakdown
   */
  evaluate(board, color) {
    const startTime = Date.now();
    const context = this.getContext(board);
    let score = 0;
    const breakdown = {};
    
    // Material + PST (always important, uses game phase)
    if (this.config.useMaterial) {
      const materialScore = evaluateMaterial(
        board, color, 
        this.config.weights.material,
        context.gamePhase  // Pass game phase for PST interpolation
      );
      score += materialScore;
      breakdown.material = materialScore;
    }
    
    // Center control (less important in endgame)
    if (this.config.useCenterControl) {
      const centerWeight = this.config.weights.centerControl * (0.5 + 0.5 * context.gamePhase);
      const centerScore = evaluateCenterControl(board, color, centerWeight);
      score += centerScore;
      breakdown.centerControl = centerScore;
    }
    
    // Development (only in opening, first ~20 moves)
    if (this.config.useDevelopment) {
      const devScore = evaluateDevelopment(
        board, color, 
        context.moveCount, 
        this.config.weights.development
      );
      score += devScore;
      breakdown.development = devScore;
    }
    
    // Pawn structure (always important)
    if (this.config.usePawnStructure) {
      const pawnScore = evaluatePawnStructure(
        board, color, 
        this.config.weights.pawnStructure
      );
      score += pawnScore;
      breakdown.pawnStructure = pawnScore;
    }
    
    // King safety (less important in endgame)
    if (this.config.useKingSafety) {
      const safetyScore = evaluateKingSafety(
        board, color, 
        context.endgameWeight, 
        this.config.weights.kingSafety
      );
      score += safetyScore;
      breakdown.kingSafety = safetyScore;
    }
    
    const evalTime = Date.now() - startTime;
    
    logger.evalBreakdown(board.toFen(), breakdown, score);
    
    logger.eval('debug', {
      fen: board.toFen(),
      color,
      totalScore: score,
      breakdown,
      context: {
        gamePhase: context.gamePhase.toFixed(2),
        moveCount: context.moveCount
      },
      evalTimeMs: evalTime
    }, `Evaluation: ${score} for ${color}`);
    
    return { score, breakdown, context };
  }

  setHeuristic(name, enabled) {
    const key = 'use' + name.charAt(0).toUpperCase() + name.slice(1);
    if (key in this.config) {
      this.config[key] = enabled;
      logger.eval('info', { heuristic: name, enabled }, `Heuristic ${name} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  setWeight(name, weight) {
    if (name in this.config.weights) {
      this.config.weights[name] = weight;
      logger.eval('info', { heuristic: name, weight }, `Weight for ${name} set to ${weight}`);
    }
  }
}

export default Evaluator;