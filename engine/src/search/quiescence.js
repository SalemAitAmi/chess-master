/**
 * Quiescence search for tactical stability
 * Only searches captures and promotions to avoid horizon effect
 */

import { PIECE_VALUES, PIECES } from '../core/constants.js';
import { generateAllLegalMoves, isInCheck } from '../core/moveGeneration.js';
import logger from '../logging/logger.js';

/**
 * Quiescence search - extends search until position is "quiet"
 * @param {Board} board - Current board state
 * @param {number} alpha - Alpha bound
 * @param {number} beta - Beta bound
 * @param {string} color - Side to move
 * @param {Evaluator} evaluator - Evaluation function
 * @param {string} searchColor - Original searching color (for eval perspective)
 * @param {number} depth - Current quiescence depth (starts at 0)
 * @param {number} maxDepth - Maximum quiescence depth
 */
export function quiescenceSearch(board, alpha, beta, color, evaluator, searchColor, depth = 0, maxDepth = 8) {
  // Get static evaluation (stand pat)
  const evalResult = evaluator.evaluate(board, searchColor);
  const standPat = evalResult.score;
  
  // Maximum depth reached
  if (depth >= maxDepth) {
    logger.search('trace', { 
      depth, 
      maxDepth, 
      standPat 
    }, 'Q-search max depth reached');
    return standPat;
  }
  
  const inCheck = isInCheck(board, color);
  
  // If in check, we must search all evasions (can't stand pat)
  if (!inCheck) {
    // Stand pat cutoff
    if (standPat >= beta) {
      logger.search('trace', { 
        depth, 
        standPat, 
        beta, 
        cutoff: 'stand-pat-beta' 
      }, 'Q-search stand pat beta cutoff');
      return beta;
    }
    
    // Update alpha with stand pat
    if (standPat > alpha) {
      alpha = standPat;
    }
    
    // Delta pruning - big delta for queen promotions
    const DELTA_MARGIN = 200;
    const BIG_DELTA = PIECE_VALUES[PIECES.QUEEN] + DELTA_MARGIN;
    
    if (standPat + BIG_DELTA < alpha) {
      logger.search('trace', { 
        depth, 
        standPat, 
        bigDelta: BIG_DELTA, 
        alpha,
        cutoff: 'delta' 
      }, 'Q-search delta pruned');
      return alpha;
    }
  }
  
  const oppositeColor = color === 'white' ? 'black' : 'white';
  const allMoves = generateAllLegalMoves(board, color);
  
  // Filter to tactical moves
  let tacticalMoves;
  if (inCheck) {
    // In check - search all evasions
    tacticalMoves = allMoves;
    logger.search('trace', { 
      depth, 
      inCheck: true, 
      evasions: tacticalMoves.length 
    }, 'Q-search: in check, searching all evasions');
  } else {
    // Not in check - only captures and promotions
    tacticalMoves = allMoves.filter(m => 
      m.capturedPiece !== null || m.isPromotion
    );
  }
  
  if (tacticalMoves.length === 0) {
    if (inCheck) {
      // Checkmate
      return -50000 + depth; // Prefer shorter mates
    }
    return standPat;
  }
  
  // Sort by MVV-LVA with SEE estimation
  tacticalMoves.sort((a, b) => {
    const aValue = getMoveValue(a);
    const bValue = getMoveValue(b);
    return bValue - aValue;
  });
  
  logger.search('trace', {
    depth,
    tacticalMoves: tacticalMoves.length,
    topMoves: tacticalMoves.slice(0, 3).map(m => ({
      move: m.algebraic,
      value: getMoveValue(m)
    }))
  }, `Q-search at depth ${depth}: ${tacticalMoves.length} tactical moves`);
  
  for (const move of tacticalMoves) {
    // Per-move delta pruning (skip losing captures)
    if (!inCheck && move.capturedPiece !== null) {
      const DELTA_PER_MOVE = 100;
      const maxGain = PIECE_VALUES[move.capturedPiece] +
                      (move.isPromotion ? PIECE_VALUES[PIECES.QUEEN] - PIECE_VALUES[PIECES.PAWN] : 0);
      
      if (standPat + maxGain + DELTA_PER_MOVE < alpha) {
        logger.search('trace', { 
          move: move.algebraic, 
          maxGain, 
          standPat, 
          alpha 
        }, 'Q-search per-move delta pruned');
        continue;
      }
      
      // SEE pruning - skip clearly losing captures
      const seeValue = PIECE_VALUES[move.capturedPiece] - PIECE_VALUES[move.piece];
      if (seeValue < -200) {
        logger.search('trace', { 
          move: move.algebraic, 
          seeValue 
        }, 'Q-search SEE pruned');
        continue;
      }
    }
    
    board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
    const score = -quiescenceSearch(board, -beta, -alpha, oppositeColor, evaluator, searchColor, depth + 1, maxDepth);
    board.undoMove();
    
    if (score >= beta) {
      logger.search('trace', { 
        depth, 
        move: move.algebraic, 
        score, 
        beta, 
        cutoff: 'beta' 
      }, 'Q-search beta cutoff');
      return beta;
    }
    
    if (score > alpha) {
      alpha = score;
    }
  }
  
  return alpha;
}

/**
 * Get move value for sorting (MVV-LVA with promotion bonus)
 */
function getMoveValue(move) {
  let value = 0;
  
  // Capture value
  if (move.capturedPiece !== null) {
    value += PIECE_VALUES[move.capturedPiece] * 10 - PIECE_VALUES[move.piece];
  }
  
  // Promotion value
  if (move.isPromotion) {
    value += PIECE_VALUES[move.promotionPiece || PIECES.QUEEN];
  }
  
  return value;
}

export default quiescenceSearch;