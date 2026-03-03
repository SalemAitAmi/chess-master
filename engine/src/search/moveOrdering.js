/**
 * Move ordering for optimal alpha-beta pruning
 */

import { PIECE_VALUES, PIECES } from '../core/constants.js';
import { evaluatePawnPush } from '../evaluation/pawnPush.js';
import logger from '../logging/logger.js';

export const MOVE_PRIORITY = {
  TT_MOVE: 20000,
  PROMOTION_QUEEN: 15000,
  PROMOTION_OTHER: 14000,
  WINNING_CAPTURE: 12000,
  KILLER_MOVE_1: 10000,
  KILLER_MOVE_2: 9500,
  COUNTER_MOVE: 9000,
  EQUAL_CAPTURE: 8500,
  PAWN_DOUBLE_PUSH: 8000,
  LOSING_CAPTURE: 7000,
  HISTORY_BASE: 0
};

export class MVVLVAOrdering {
  /**
   * MVV-LVA: Most Valuable Victim - Least Valuable Attacker
   * Prioritizes capturing high-value pieces with low-value pieces
   */
  getScore(move) {
    if (move.capturedPiece === null && move.capturedPiece !== 0) return 0;
    
    const victimValue = PIECE_VALUES[move.capturedPiece] || 0;
    const attackerValue = PIECE_VALUES[move.piece] || 0;
    const captureScore = victimValue * 10 - attackerValue;
    
    if (captureScore > 0) {
      return MOVE_PRIORITY.WINNING_CAPTURE + captureScore;
    } else if (captureScore === 0) {
      return MOVE_PRIORITY.EQUAL_CAPTURE;
    } else {
      return MOVE_PRIORITY.LOSING_CAPTURE + captureScore;
    }
  }
}

export class KillerMoveTable {
  constructor() {
    this.killers = {};
    this.maxKillersPerPly = 2;
  }

  getScore(move, ply) {
    const killers = this.killers[ply] || [];
    for (let i = 0; i < killers.length; i++) {
      const killer = killers[i];
      if (move.fromSquare === killer.fromSquare && move.toSquare === killer.toSquare) {
        return i === 0 ? MOVE_PRIORITY.KILLER_MOVE_1 : MOVE_PRIORITY.KILLER_MOVE_2;
      }
    }
    return 0;
  }

  add(move, ply) {
    // Don't store captures as killers
    if (move.capturedPiece !== null) return;
    
    if (!this.killers[ply]) {
      this.killers[ply] = [];
    }
    
    // Check if already exists
    const dominated = this.killers[ply].some(k => 
      k.fromSquare === move.fromSquare && k.toSquare === move.toSquare
    );
    if (dominated) return;
    
    // Add to front
    this.killers[ply].unshift({ 
      fromSquare: move.fromSquare, 
      toSquare: move.toSquare,
      piece: move.piece
    });
    
    // Keep only max killers
    if (this.killers[ply].length > this.maxKillersPerPly) {
      this.killers[ply].pop();
    }
    
    logger.moveOrder('trace', { 
      ply, 
      move: move.algebraic,
      killersAtPly: this.killers[ply].length 
    }, `Added killer move at ply ${ply}`);
  }

  clear() {
    this.killers = {};
  }
}

export class HistoryTable {
  constructor() {
    // Indexed by "fromSquare-toSquare"
    this.history = {};
    this.maxValue = 8000;
    this.maxEntries = 10000;
  }

  getScore(move) {
    const key = `${move.fromSquare}-${move.toSquare}`;
    return this.history[key] || 0;
  }

  update(move, depth, isGoodMove = true) {
    // Don't store captures in history
    if (move.capturedPiece !== null) return;
    
    const key = `${move.fromSquare}-${move.toSquare}`;
    const bonus = depth * depth;
    
    if (isGoodMove) {
      // Good move (caused cutoff) - increase score
      this.history[key] = Math.min(
        (this.history[key] || 0) + bonus,
        this.maxValue
      );
    } else {
      // Move searched but didn't cause cutoff - slight penalty
      this.history[key] = Math.max(
        (this.history[key] || 0) - Math.floor(bonus / 2),
        0
      );
    }
  }

  /**
   * Age the history table at start of new search
   * Prevents old good moves from dominating
   */
  age() {
    const entries = Object.entries(this.history);
    
    // Age down all values
    for (const key in this.history) {
      this.history[key] = Math.floor(this.history[key] / 2);
    }
    
    // Prune entries that are too low
    for (const key in this.history) {
      if (this.history[key] < 10) {
        delete this.history[key];
      }
    }
    
    // If still too large, remove lowest scoring entries
    if (Object.keys(this.history).length > this.maxEntries) {
      const sorted = Object.entries(this.history)
        .sort((a, b) => b[1] - a[1])
        .slice(0, this.maxEntries);
      
      this.history = Object.fromEntries(sorted);
      
      logger.moveOrder('debug', { 
        pruned: entries.length - sorted.length 
      }, 'History table pruned');
    }
    
    logger.moveOrder('debug', { 
      entriesRemaining: Object.keys(this.history).length 
    }, 'History table aged');
  }

  clear() {
    this.history = {};
  }
}

export class CounterMoveTable {
  constructor() {
    // Indexed by [piece][toSquare] -> counter move info
    this.table = {};
  }

  _key(piece, toSquare) {
    return `${piece}-${toSquare}`;
  }

  get(piece, toSquare) {
    if (piece === undefined || piece === null || toSquare === undefined) return null;
    const key = this._key(piece, toSquare);
    return this.table[key] || null;
  }

  update(lastMove, counterMove) {
    if (!lastMove || counterMove.capturedPiece !== null) return;
    
    const key = this._key(lastMove.piece, lastMove.toSquare);
    this.table[key] = {
      fromSquare: counterMove.fromSquare,
      toSquare: counterMove.toSquare
    };
    
    logger.moveOrder('trace', {
      lastMove: lastMove.algebraic,
      counterMove: counterMove.algebraic
    }, 'Counter move stored');
  }

  clear() {
    this.table = {};
  }
}

export class MoveOrderer {
  constructor(config = {}) {
    this.mvvlva = new MVVLVAOrdering();
    this.killers = config.useKillerMoves !== false ? new KillerMoveTable() : null;
    this.history = config.useHistoryHeuristic !== false ? new HistoryTable() : null;
    this.counterMoves = new CounterMoveTable();
    this.usePawnPush = config.usePawnPush !== false;
    
    logger.moveOrder('info', {
      useKillers: this.killers !== null,
      useHistory: this.history !== null,
      usePawnPush: this.usePawnPush
    }, 'MoveOrderer initialized');
  }

  /**
   * Order moves for optimal alpha-beta pruning
   * @param {Array} moves - Legal moves to order
   * @param {number} ply - Current ply in search
   * @param {Board} board - Current board state
   * @param {string} color - Side to move
   * @param {Object|null} ttMove - Best move from transposition table
   * @param {Object|null} lastMove - Previous move played (for counter-move)
   * @returns {Array} Ordered moves
   */
  orderMoves(moves, ply, board, color, ttMove = null, lastMove = null) {
    const startTime = Date.now();
    
    const scored = moves.map(move => {
      let score = 0;
      const scoreBreakdown = {};
      
      // TT move gets highest priority
      if (ttMove && move.fromSquare === ttMove.fromSquare && move.toSquare === ttMove.toSquare) {
        score += MOVE_PRIORITY.TT_MOVE;
        move.isTTMove = true;
        scoreBreakdown.ttMove = MOVE_PRIORITY.TT_MOVE;
      }
      
      // Promotions
      if (move.isPromotion) {
        if (move.promotionPiece === PIECES.QUEEN) {
          score += MOVE_PRIORITY.PROMOTION_QUEEN;
          scoreBreakdown.promotion = MOVE_PRIORITY.PROMOTION_QUEEN;
        } else {
          score += MOVE_PRIORITY.PROMOTION_OTHER;
          scoreBreakdown.promotion = MOVE_PRIORITY.PROMOTION_OTHER;
        }
      }
      
      // Captures (MVV-LVA)
      if (move.capturedPiece !== null) {
        const captureScore = this.mvvlva.getScore(move);
        score += captureScore;
        scoreBreakdown.capture = captureScore;
      }
      
      // Killer moves
      if (this.killers) {
        const killerScore = this.killers.getScore(move, ply);
        if (killerScore > 0) {
          score += killerScore;
          move.isKiller = true;
          scoreBreakdown.killer = killerScore;
        }
      }
      
      // Counter move bonus
      if (lastMove) {
        const counter = this.counterMoves.get(lastMove.piece, lastMove.toSquare);
        if (counter && 
            move.fromSquare === counter.fromSquare && 
            move.toSquare === counter.toSquare) {
          score += MOVE_PRIORITY.COUNTER_MOVE;
          move.isCounterMove = true;
          scoreBreakdown.counterMove = MOVE_PRIORITY.COUNTER_MOVE;
        }
      }
      
      // History heuristic
      if (this.history && move.capturedPiece === null) {
        const historyScore = this.history.getScore(move);
        if (historyScore > 0) {
          score += historyScore;
          move.historyScore = historyScore;
          scoreBreakdown.history = historyScore;
        }
      }
      
      // Pawn double push bonus (opening consideration)
      if (this.usePawnPush && move.piece === PIECES.PAWN) {
        const pushBonus = evaluatePawnPush(move, board, color);
        if (pushBonus > 0) {
          score += MOVE_PRIORITY.PAWN_DOUBLE_PUSH + pushBonus;
          scoreBreakdown.pawnPush = MOVE_PRIORITY.PAWN_DOUBLE_PUSH + pushBonus;
        }
      }
      
      move.orderScore = score;
      move.scoreBreakdown = scoreBreakdown;
      return move;
    });
    
    // Sort by score descending
    scored.sort((a, b) => b.orderScore - a.orderScore);
    
    const elapsed = Date.now() - startTime;
    
    logger.moveOrderingDecision(scored, ply, { 
      color, 
      ttMove: ttMove?.algebraic,
      lastMove: lastMove?.algebraic,
      orderingTimeMs: elapsed
    });
    
    return scored;
  }

  /**
   * Add a killer move at the given ply
   */
  addKiller(move, ply) {
    if (this.killers) {
      this.killers.add(move, ply);
    }
  }

  /**
   * Update history table for a move
   */
  updateHistory(move, depth, isGoodMove = true) {
    if (this.history) {
      this.history.update(move, depth, isGoodMove);
    }
  }

  /**
   * Record a counter-move relationship
   */
  updateCounterMove(lastMove, goodMove) {
    this.counterMoves.update(lastMove, goodMove);
  }

  /**
   * Prepare for a new search (age history, etc.)
   */
  prepareNewSearch() {
    if (this.history) {
      this.history.age();
    }
    // Don't clear killers between iterations of iterative deepening
    // They're still useful
  }

  /**
   * Full clear for new game
   */
  clear() {
    if (this.killers) this.killers.clear();
    if (this.history) this.history.clear();
    this.counterMoves.clear();
    logger.moveOrder('info', {}, 'MoveOrderer cleared');
  }
}

export default MoveOrderer;