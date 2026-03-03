/**
 * Main search implementation - iterative deepening with alpha-beta and PVS
 * Includes comprehensive turn-based decision logging
 */

import { SCORE, PIECES } from '../core/constants.js';
import { generateAllLegalMoves, isInCheck, hasLegalMoves } from '../core/moveGeneration.js';
import { Evaluator } from '../evaluation/evaluate.js';
import { MoveOrderer } from './moveOrdering.js';
import { quiescenceSearch } from './quiescence.js';
import { TranspositionTable, TT_FLAG } from '../tables/transposition.js';
import { detectGameStage, getStageWeights, checkOpeningPrinciples } from '../utils/gameStage.js';
import { GAME_STAGE } from '../logging/categories.js';
import logger, { LOG_CATEGORY } from '../logging/logger.js';

/**
 * Check if side has non-pawn material (for null move pruning)
 */
function hasNonPawnMaterial(board, color) {
  const colorIdx = color === 'white' ? 0 : 1;
  return board.bbPieces[colorIdx][PIECES.QUEEN].popCount() > 0 ||
         board.bbPieces[colorIdx][PIECES.ROOK].popCount() > 0 ||
         board.bbPieces[colorIdx][PIECES.BISHOP].popCount() > 0 ||
         board.bbPieces[colorIdx][PIECES.KNIGHT].popCount() > 0;
}

/** Maximum number of candidate moves to log (avoid huge JSON) */
const MAX_LOGGED_CANDIDATES = 10;

export class SearchEngine {
  constructor(config = {}) {
    this.config = {
      maxDepth: config.maxDepth || 64,
      useQuiescence: config.useQuiescence !== false,
      quiescenceDepth: config.quiescenceDepth || 8,
      useTranspositionTable: config.useTranspositionTable !== false,
      useNullMovePruning: config.useNullMovePruning !== false,
      useLateMovereduction: config.useLateMovereduction !== false,
      useFutilityPruning: config.useFutilityPruning !== false,
      useAspirationWindows: config.useAspirationWindows !== false,
      usePVS: config.usePVS !== false,
      useIID: config.useIID !== false,
      useOpeningPrinciples: config.useOpeningPrinciples !== false,
      ...config
    };
    
    this.evaluator = new Evaluator(config);
    this.moveOrderer = new MoveOrderer(config);
    this.tt = this.config.useTranspositionTable ? new TranspositionTable(64) : null;
    
    // Search state
    this.nodes = 0;
    this.qNodes = 0;
    this.maxDepthReached = 0;
    this.searchStartTime = 0;
    this.stopSearch = false;
    this.searchColor = 'white';
    
    // Principal variation
    this.pv = [];
    
    // Current game stage
    this.currentStage = null;
    this.previousStage = null;
    
    // Statistics for logging
    this.stats = {
      ttHits: 0,
      ttCutoffs: 0,
      nullMoveCutoffs: 0,
      futilityCutoffs: 0,
      lmrSearches: 0,
      lmrResearches: 0,
      pvsCutoffs: 0
    };
    
    // Root move scores for decision logging
    this.rootMoveResults = [];
    
    logger.search('info', { config: this.config }, 'SearchEngine initialized');
  }

  resetSearchState() {
    this.nodes = 0;
    this.qNodes = 0;
    this.maxDepthReached = 0;
    this.stopSearch = false;
    this.pv = [];
    this.rootMoveResults = [];
    this.stats = {
      ttHits: 0,
      ttCutoffs: 0,
      nullMoveCutoffs: 0,
      futilityCutoffs: 0,
      lmrSearches: 0,
      lmrResearches: 0,
      pvsCutoffs: 0
    };
    
    if (this.tt) this.tt.newSearch();
    this.moveOrderer.prepareNewSearch();
  }

  search(board, maxDepth = null) {
    this.resetSearchState();
    this.searchStartTime = Date.now();
    this.searchColor = board.gameState.activeColor;
    board.searchColor = this.searchColor;
    
    // Detect game stage
    const stageInfo = detectGameStage(board);
    this.previousStage = this.currentStage;
    this.currentStage = stageInfo.stage;
    
    // Log stage transition if changed
    if (this.previousStage && this.previousStage !== this.currentStage) {
      logger.logStageTransition(this.previousStage, this.currentStage, stageInfo);
    }
    
    // Get stage-specific weights
    const stageWeights = getStageWeights(stageInfo.stage);
    
    const depth = maxDepth || this.config.maxDepth;
    const fen = board.toFen();
    
    // Start turn in logger
    const turnId = logger.startTurn(fen, this.searchColor, stageInfo);
    
    logger.search('info', { 
      turnId,
      color: this.searchColor, 
      maxDepth: depth,
      fen,
      stage: stageInfo.stage,
      stageWeights
    }, 'Starting search');
    
    // Log stage-specific info
    logger.stage('info', {
      stage: stageInfo.stage,
      fullMoveNumber: stageInfo.fullMoveNumber,
      materialPhase: stageInfo.materialPhase,
      phasePercent: stageInfo.phasePercent,
      priorities: stageInfo.priorities,
      stageReasons: stageInfo.stageReasons
    }, `Stage: ${stageInfo.stage} (move ${stageInfo.fullMoveNumber})`);
    
    let bestMove = null;
    let bestScore = 0;
    
    // Aspiration window settings
    const ASPIRATION_WINDOW = 50;
    const ASPIRATION_MIN_DEPTH = 5;
    
    // Iterative deepening
    for (let d = 1; d <= depth; d++) {
      if (this.stopSearch) break;
      
      const iterationStartTime = Date.now();
      const iterationStartNodes = this.nodes;
      
      let alpha = -SCORE.INFINITY;
      let beta = SCORE.INFINITY;
      let delta = ASPIRATION_WINDOW;
      
      // Use aspiration windows after sufficient depth
      if (this.config.useAspirationWindows && 
          d >= ASPIRATION_MIN_DEPTH && 
          Math.abs(bestScore) < SCORE.MATE_THRESHOLD) {
        alpha = bestScore - delta;
        beta = bestScore + delta;
      }
      
      let result;
      let searchAttempts = 0;
      const maxAttempts = 5;
      
      // Aspiration window loop
      while (searchAttempts < maxAttempts) {
        searchAttempts++;
        
        result = this.alphaBeta(board, d, alpha, beta, this.searchColor, 0, null, stageInfo);
        
        if (this.stopSearch) break;
        
        if (result.score <= alpha) {
          alpha = Math.max(-SCORE.INFINITY, alpha - delta);
          delta *= 2;
          continue;
        }
        
        if (result.score >= beta) {
          beta = Math.min(SCORE.INFINITY, beta + delta);
          delta *= 2;
          continue;
        }
        
        break;
      }
      
      if (this.stopSearch) break;
      
      if (result && result.move) {
        bestMove = result.move;
        bestScore = result.score;
        
        // Store root move results from final iteration
        if (result.rootMoves) {
          this.rootMoveResults = result.rootMoves;
        }
        
        // Extract PV
        this.extractPV(board, d);
        
        const iterationTime = Date.now() - iterationStartTime;
        const iterationNodes = this.nodes - iterationStartNodes;
        const nps = iterationTime > 0 ? Math.round(iterationNodes / (iterationTime / 1000)) : 0;

        if (d % 3 === 0) {
        logger.flush().catch(err => {
          console.error('[LOGGER] Flush error:', err);
        });
      }
      
      // **ADD THIS: Memory usage check**
      if (d >= 4) {
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        
        if (heapUsedMB > 3500) { // Warn at 3.5GB
          console.warn(`[MEMORY WARNING] High memory usage: ${heapUsedMB}MB at depth ${d}`);
          logger.search('warn', { heapUsedMB, depth: d }, 'High memory usage detected');
        }
        
        if (heapUsedMB > 3800) { // Stop before crash at 3.8GB
          console.error(`[MEMORY ERROR] Critical memory usage: ${heapUsedMB}MB - stopping search`);
          this.stopSearch = true;
          break;
        }
      }
        
        logger.search('info', {
          depth: d,
          score: bestScore,
          nodes: this.nodes,
          qNodes: this.qNodes,
          nps,
          time: iterationTime,
          pv: this.pv.map(m => m.algebraic).join(' '),
          bestMove: bestMove.algebraic,
          stage: stageInfo.stage
        }, `Depth ${d} complete: ${bestMove.algebraic} (${bestScore})`);
        
        logger.pv('info', {
          depth: d,
          score: bestScore,
          pv: this.pv.map(m => m.algebraic),
          pvLength: this.pv.length,
          stage: stageInfo.stage
        }, `PV: ${this.pv.map(m => m.algebraic).join(' ')}`);
        
        if (Math.abs(bestScore) > SCORE.MATE_THRESHOLD) {
          const mateIn = Math.ceil((SCORE.MATE - Math.abs(bestScore)) / 2);
          logger.search('info', { mateIn, score: bestScore }, `Mate found in ${mateIn}`);
          break;
        }
      }
    }
    
    const totalTime = Date.now() - this.searchStartTime;
    
    // Get evaluation for decision log (single eval, not per-move)
    const evalResult = this.evaluator.evaluate(board, this.searchColor);
    
    // Check opening principles if applicable
    let openingAnalysis = null;
    if (stageInfo.stage === GAME_STAGE.OPENING && bestMove && this.config.useOpeningPrinciples) {
      openingAnalysis = checkOpeningPrinciples(board, bestMove, this.searchColor);
      if (openingAnalysis.violations.length > 0) {
        logger.logOpeningViolation(bestMove, openingAnalysis.violations, openingAnalysis.bonuses);
      }
    }
    
    // Record candidate moves from search results (no re-evaluation needed)
    const candidatesToLog = this.rootMoveResults.slice(0, MAX_LOGGED_CANDIDATES);
    for (let i = 0; i < candidatesToLog.length; i++) {
      const moveResult = candidatesToLog[i];
      logger.recordCandidateMove(
        moveResult,
        moveResult.score,
        moveResult.orderScore || 0,
        null, // Skip per-move eval breakdown to save memory
        i + 1
      );
    }
    
    // Finalize turn with all collected data
    logger.finalizeTurn(
      bestMove,
      {
        score: bestScore,
        depth: this.maxDepthReached,
        nodes: this.nodes,
        qNodes: this.qNodes,
        time: totalTime,
        pv: this.pv,
        source: 'search',
        stats: { ...this.stats }
      },
      evalResult,
      openingAnalysis
    );
    
    logger.search('info', {
      totalNodes: this.nodes,
      quiescenceNodes: this.qNodes,
      totalTime,
      nps: totalTime > 0 ? Math.round(this.nodes / (totalTime / 1000)) : 0,
      maxDepthReached: this.maxDepthReached,
      bestMove: bestMove?.algebraic,
      bestScore,
      stage: stageInfo.stage,
      ttStats: this.tt?.getStats()
    }, 'Search complete');
    
    return {
      bestMove,
      score: bestScore,
      nodes: this.nodes,
      depth: this.maxDepthReached,
      time: totalTime,
      pv: this.pv,
      stageInfo
    };
  }

  alphaBeta(board, depth, alpha, beta, color, ply, lastMove, stageInfo) {
    this.nodes++;
    this.maxDepthReached = Math.max(this.maxDepthReached, ply);
    
    if (this.stopSearch) {
      return { score: 0, move: null };
    }
    
    if (this.nodes % 50000 === 0 && global.gc) {
      global.gc();
    }

    const isRoot = ply === 0;
    const isPvNode = beta - alpha > 1;
    const oppositeColor = color === 'white' ? 'black' : 'white';
    const inCheck = isInCheck(board, color);
    
    // Check extension
    const extension = inCheck ? 1 : 0;
    
    // Get legal moves
    const moves = generateAllLegalMoves(board, color);
    
    // Terminal node detection
    if (moves.length === 0) {
      if (inCheck) {
        const mateScore = SCORE.MATE - ply;
        return { score: color === this.searchColor ? -mateScore : mateScore, move: null };
      }
      return { score: SCORE.DRAW, move: null };
    }
    
    // Transposition table probe
    let ttMove = null;
    if (this.tt) {
      const ttResult = this.tt.probe(board.gameState.zobristKey, depth, alpha, beta);
      if (ttResult) {
        this.stats.ttHits++;
        ttMove = ttResult.bestMove;
        
        if (!isRoot && ttResult.usable) {
          this.stats.ttCutoffs++;
          return { score: ttResult.score, move: ttResult.bestMove };
        }
      }
    }
    
    // Leaf node
    if (depth <= 0) {
      let score;
      if (this.config.useQuiescence) {
        score = quiescenceSearch(
          board, alpha, beta, color, 
          this.evaluator, this.searchColor,
          0, this.config.quiescenceDepth
        );
        this.qNodes++;
      } else {
        const evalResult = this.evaluator.evaluate(board, this.searchColor);
        score = evalResult.score;
      }
      return { score, move: null };
    }
    
    // IID
    if (this.config.useIID && !ttMove && depth >= 4 && isPvNode) {
      const iidDepth = Math.max(1, depth - 3);
      const iidResult = this.alphaBeta(board, iidDepth, alpha, beta, color, ply, lastMove, stageInfo);
      if (iidResult.move) {
        ttMove = iidResult.move;
      }
    }
    
    // Null Move Pruning
    if (this.config.useNullMovePruning &&
        depth >= 3 &&
        !isRoot &&
        !inCheck &&
        !isPvNode &&
        hasNonPawnMaterial(board, color)) {
      
      const R = depth > 6 ? 3 : 2;
      
      // Null move: just flip the side to move without actually making a move
      // Save and restore the minimal state needed
      const savedEp = board.gameState.enPassantSquare;
      const savedActiveColor = board.gameState.activeColor;
      const savedZobrist = board.gameState.zobristKey;
      board.gameState.enPassantSquare = -1;
      board.gameState.activeColor = oppositeColor;
      // Update zobrist for side change (not perfect but sufficient for null move)
      board.gameState.zobristKey ^= 0xFFFFFFFFFFFFFFFFn;
      
      const nullResult = this.alphaBeta(
        board, depth - R - 1, -beta, -beta + 1, 
        oppositeColor, ply + 1, null, stageInfo
      );
      const nullScore = -nullResult.score;
      
      board.gameState.enPassantSquare = savedEp;
      board.gameState.activeColor = savedActiveColor;
      board.gameState.zobristKey = savedZobrist;
      
      if (nullScore >= beta) {
        this.stats.nullMoveCutoffs++;
        return { score: beta, move: null };
      }
    }
    
    // Static evaluation for futility pruning
    let staticEval = null;
    const FUTILITY_MARGIN = [0, 150, 300, 450];
    const canFutilityPrune = this.config.useFutilityPruning &&
                             depth <= 3 &&
                             !inCheck &&
                             !isPvNode &&
                             Math.abs(alpha) < SCORE.MATE_THRESHOLD;
    
    if (canFutilityPrune) {
      const evalResult = this.evaluator.evaluate(board, this.searchColor);
      staticEval = evalResult.score;
    }
    
    // Move ordering with opening principle adjustments
    let orderedMoves = this.moveOrderer.orderMoves(moves, ply, board, color, ttMove, lastMove);
    
    // Apply opening principle adjustments at root
    if (isRoot && stageInfo?.stage === GAME_STAGE.OPENING && this.config.useOpeningPrinciples) {
      orderedMoves = this.applyOpeningPrincipleScores(orderedMoves, board, color);
    }
    
    let bestMove = orderedMoves[0];
    let bestScore = -SCORE.INFINITY;
    let nodeType = TT_FLAG.UPPER_BOUND;
    let movesSearched = 0;
    const rootMoves = isRoot ? [] : null;
    
    for (let i = 0; i < orderedMoves.length; i++) {
      const move = orderedMoves[i];
      const isCapture = move.capturedPiece !== null;
      const isPromotion = move.isPromotion;
      const givesCheck = this.moveCausesCheck(board, move, oppositeColor);
      
      // Futility pruning
      if (canFutilityPrune && 
          movesSearched > 0 && 
          !isCapture && 
          !isPromotion &&
          !givesCheck &&
          staticEval + FUTILITY_MARGIN[depth] <= alpha) {
        this.stats.futilityCutoffs++;
        continue;
      }
      
      // LMR
      let reduction = 0;
      if (this.config.useLateMovereduction && 
          movesSearched >= 4 && 
          depth >= 3 && 
          !isCapture && 
          !isPromotion && 
          !inCheck &&
          !givesCheck &&
          !move.isKiller) {
        reduction = Math.floor(Math.log2(depth) * Math.log2(movesSearched + 1) * 0.5);
        reduction = Math.min(reduction, depth - 2);
        reduction = Math.max(reduction, 1);
        this.stats.lmrSearches++;
      }
      
      board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
      
      let score;
      
      // PVS
      if (this.config.usePVS && movesSearched > 0) {
        const searchDepth = depth - 1 + extension - reduction;
        score = -this.alphaBeta(
          board, searchDepth, -alpha - 1, -alpha, 
          oppositeColor, ply + 1, move, stageInfo
        ).score;
        
        if (score > alpha && score < beta) {
          this.stats.pvsCutoffs++;
          
          if (reduction > 0) {
            this.stats.lmrResearches++;
            score = -this.alphaBeta(
              board, depth - 1 + extension, -alpha - 1, -alpha, 
              oppositeColor, ply + 1, move, stageInfo
            ).score;
          }
          
          if (score > alpha && score < beta) {
            score = -this.alphaBeta(
              board, depth - 1 + extension, -beta, -alpha, 
              oppositeColor, ply + 1, move, stageInfo
            ).score;
          }
        }
      } else {
        score = -this.alphaBeta(
          board, depth - 1 + extension - reduction, -beta, -alpha, 
          oppositeColor, ply + 1, move, stageInfo
        ).score;
        
        if (reduction > 0 && score > alpha) {
          this.stats.lmrResearches++;
          score = -this.alphaBeta(
            board, depth - 1 + extension, -beta, -alpha, 
            oppositeColor, ply + 1, move, stageInfo
          ).score;
        }
      }
      
      board.undoMove();
      
      movesSearched++;
      
      // Store root move scores
      if (rootMoves) {
        rootMoves.push({
          ...move,
          score: score
        });
      }
      
      if (this.stopSearch) {
        return { score: 0, move: null };
      }
      
      logger.searchNode({
        depth,
        ply,
        alpha,
        beta,
        move: move.algebraic,
        score,
        nodeType: isPvNode ? 'PV' : 'non-PV',
        movesSearched,
        reduction
      });
      
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      
      if (score > alpha) {
        alpha = score;
        nodeType = TT_FLAG.EXACT;
        
        if (alpha >= beta) {
          this.moveOrderer.addKiller(move, ply);
          if (!isCapture) {
            this.moveOrderer.updateHistory(move, depth, true);
            this.moveOrderer.updateCounterMove(lastMove, move);
          }
          
          for (let j = 0; j < i; j++) {
            if (orderedMoves[j].capturedPiece === null) {
              this.moveOrderer.updateHistory(orderedMoves[j], depth, false);
            }
          }
          
          nodeType = TT_FLAG.LOWER_BOUND;
          break;
        }
      }
    }
    
    if (this.tt && !this.stopSearch) {
      this.tt.store(board.gameState.zobristKey, depth, bestScore, nodeType, bestMove);
    }
    
    // Sort root moves by score for logging
    if (rootMoves) {
      rootMoves.sort((a, b) => b.score - a.score);
    }
    
    return { 
      score: bestScore, 
      move: bestMove,
      rootMoves: rootMoves || undefined
    };
  }

  applyOpeningPrincipleScores(moves, board, color) {
    return moves.map(move => {
      const analysis = checkOpeningPrinciples(board, move, color);
      const adjustment = analysis.totalBonus + analysis.totalPenalty;
      
      if (adjustment !== 0) {
        logger.stage('debug', {
          stage: GAME_STAGE.OPENING,
          move: move.algebraic,
          originalScore: move.orderScore,
          adjustment,
          violations: analysis.violations,
          bonuses: analysis.bonuses
        }, `Opening adjustment for ${move.algebraic}: ${adjustment}`);
      }
      
      return {
        ...move,
        orderScore: move.orderScore + adjustment,
        openingAnalysis: analysis
      };
    }).sort((a, b) => b.orderScore - a.orderScore);
  }

  moveCausesCheck(board, move, opponentColor) {
    board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
    const causesCheck = isInCheck(board, opponentColor);
    board.undoMove();
    return causesCheck;
  }

  extractPV(board, depth) {
    this.pv = [];
    const seen = new Set();
    
    for (let i = 0; i < depth && this.tt; i++) {
      const key = board.gameState.zobristKey;
      const keyStr = key.toString();
      
      if (seen.has(keyStr)) break;
      seen.add(keyStr);
      
      const move = this.tt.getBestMove(key);
      if (!move) break;
      
      this.pv.push(move);
      board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
    }
    
    for (let i = 0; i < this.pv.length; i++) {
      board.undoMove();
    }
  }

  stop() {
    this.stopSearch = true;
    logger.search('info', { nodesSearched: this.nodes }, 'Search stop requested');
  }

  setOption(name, value) {
    if (name in this.config) {
      this.config[name] = value;
      logger.search('info', { name, value }, `Option set: ${name}=${value}`);
    }
    
    if (name.startsWith('use') || name === 'weights') {
      this.evaluator = new Evaluator(this.config);
      this.moveOrderer = new MoveOrderer(this.config);
    }
  }
}

export default SearchEngine;