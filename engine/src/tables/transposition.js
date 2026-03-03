/**
 * Transposition table for storing search results
 */

import logger, { LOG_CATEGORY } from '../logging/logger.js';

export const TT_FLAG = {
  EXACT: 0,
  LOWER_BOUND: 1,  // Beta cutoff (fail-high)
  UPPER_BOUND: 2   // Alpha not improved (fail-low)
};

class TTEntry {
  constructor() {
    this.key = 0n;
    this.depth = 0;
    this.score = 0;
    this.flag = TT_FLAG.EXACT;
    this.bestMove = null;
    this.age = 0;
  }
}

export class TranspositionTable {
  constructor(sizeMB = 64) {
    // Each entry is approximately 40 bytes
    const entrySize = 40;
    this.size = Math.floor((sizeMB * 1024 * 1024) / entrySize);
    this.table = new Array(this.size);
    this.currentAge = 0;
    this.hits = 0;
    this.misses = 0;
    this.stores = 0;
    this.collisions = 0;
    
    for (let i = 0; i < this.size; i++) {
      this.table[i] = new TTEntry();
    }
    
    logger.tt('info', { sizeMB, entries: this.size }, 'Transposition table initialized');
  }

  _index(key) {
    // Use lower bits of key for index
    return Number(key % BigInt(this.size));
  }

  store(key, depth, score, flag, bestMove) {
    const index = this._index(key);
    const entry = this.table[index];
    
    // Replacement strategy: always replace if deeper or same depth with newer age
    const shouldReplace = 
      entry.key === 0n ||
      entry.age !== this.currentAge ||
      depth >= entry.depth;
    
    if (shouldReplace) {
      if (entry.key !== 0n && entry.key !== key) {
        this.collisions++;
      }
      
      entry.key = key;
      entry.depth = depth;
      entry.score = score;
      entry.flag = flag;
      entry.bestMove = bestMove;
      entry.age = this.currentAge;
      this.stores++;
      
      logger.tt('trace', {
        index,
        depth,
        score,
        flag: ['EXACT', 'LOWER', 'UPPER'][flag],
        move: bestMove?.algebraic
      }, 'TT store');
    }
  }

  probe(key, depth, alpha, beta) {
    const index = this._index(key);
    const entry = this.table[index];
    
    if (entry.key !== key) {
      this.misses++;
      logger.tt('trace', { index, reason: 'key mismatch' }, 'TT miss');
      return null;
    }
    
    if (entry.depth < depth) {
      this.misses++;
      logger.tt('trace', { 
        index, 
        entryDepth: entry.depth, 
        requiredDepth: depth,
        reason: 'depth insufficient' 
      }, 'TT miss');
      return { bestMove: entry.bestMove, usable: false };
    }
    
    this.hits++;
    
    let score = entry.score;
    let usable = false;
    
    if (entry.flag === TT_FLAG.EXACT) {
      usable = true;
    } else if (entry.flag === TT_FLAG.LOWER_BOUND && score >= beta) {
      usable = true;
    } else if (entry.flag === TT_FLAG.UPPER_BOUND && score <= alpha) {
      usable = true;
    }
    
    logger.tt('trace', {
      index,
      depth: entry.depth,
      score,
      flag: ['EXACT', 'LOWER', 'UPPER'][entry.flag],
      usable,
      bestMove: entry.bestMove?.algebraic
    }, 'TT hit');
    
    return {
      score,
      flag: entry.flag,
      bestMove: entry.bestMove,
      usable
    };
  }

  getBestMove(key) {
    const index = this._index(key);
    const entry = this.table[index];
    return entry.key === key ? entry.bestMove : null;
  }

  newSearch() {
    this.currentAge++;
    this.hits = 0;
    this.misses = 0;
    this.stores = 0;
    this.collisions = 0;
  }

  clear() {
    for (let i = 0; i < this.size; i++) {
      this.table[i] = new TTEntry();
    }
    this.currentAge = 0;
    logger.tt('info', {}, 'Transposition table cleared');
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      stores: this.stores,
      collisions: this.collisions,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(2) + '%' : 'N/A',
      usage: this._calculateUsage()
    };
  }

  _calculateUsage() {
    let used = 0;
    const sampleSize = Math.min(1000, this.size);
    const step = Math.floor(this.size / sampleSize);
    
    for (let i = 0; i < this.size; i += step) {
      if (this.table[i].key !== 0n) used++;
    }
    
    return ((used / sampleSize) * 100).toFixed(2) + '%';
  }
}

export default TranspositionTable;