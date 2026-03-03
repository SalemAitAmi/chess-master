/**
 * Comprehensive logging system with turn-based JSON output
 * Errors are always escalated to console
 */

import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  LOG_CATEGORY, 
  CATEGORY_NAMES, 
  CATEGORY_FILES,
  GAME_STAGE,
  STAGE_FILES 
} from './categories.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '../../logs');
const TURN_LOG_DIR = path.join(LOG_DIR, 'turns');

// Ensure log directories exist
for (const dir of [LOG_DIR, TURN_LOG_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate unique session ID
 */
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate unique turn ID
 */
function generateTurnId(turnNumber) {
  return `turn_${turnNumber}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

class EngineLogger {
  constructor() {
    this.enabledMask = LOG_CATEGORY.NONE;
    this.loggers = new Map();
    this.stageLoggers = new Map();
    
    // Session tracking
    this.sessionId = generateSessionId();
    this.gameId = null;
    this.currentTurnNumber = 0;
    this.currentTurnId = null;
    this.currentStage = null;
    this.currentSearchId = null;
    
    // Turn data accumulator
    this.turnData = null;
    
    // Turn log file path (JSON)
    this.turnLogPath = path.join(TURN_LOG_DIR, `game_${this.sessionId}.json`);
    this.turnsArray = [];
    
    // Console logger for errors (always active)
    this.consoleLogger = pino({
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname'
        }
      }
    });
    
    this._initializeLoggers();
    this._initializeStageLoggers();
    this._initializeTurnLog();
  }

  _initializeLoggers() {
    for (const [category, filename] of Object.entries(CATEGORY_FILES)) {
      const categoryNum = parseInt(category);
      const logPath = path.join(LOG_DIR, filename);
      
      const destination = pino.destination({
        dest: logPath,
        sync: false,
        mkdir: true
      });
      
      const logger = pino({
        level: 'trace',
        base: { 
          category: CATEGORY_NAMES[categoryNum],
          sessionId: this.sessionId
        },
        timestamp: pino.stdTimeFunctions.isoTime
      }, destination);
      
      this.loggers.set(categoryNum, logger);
    }
  }

  _initializeStageLoggers() {
    const stageDir = path.join(LOG_DIR, 'stages');
    if (!fs.existsSync(stageDir)) {
      fs.mkdirSync(stageDir, { recursive: true });
    }
    
    for (const [stage, filename] of Object.entries(STAGE_FILES)) {
      const logPath = path.join(stageDir, filename);
      
      const destination = pino.destination({
        dest: logPath,
        sync: false,
        mkdir: true
      });
      
      const logger = pino({
        level: 'trace',
        base: { 
          stage,
          sessionId: this.sessionId
        },
        timestamp: pino.stdTimeFunctions.isoTime
      }, destination);
      
      this.stageLoggers.set(stage, logger);
    }
  }

  _initializeTurnLog() {
    // Initialize empty turns array file
    this._saveTurnsToFile();
  }

  _saveTurnsToFile() {
    try {
      const data = {
        sessionId: this.sessionId,
        gameId: this.gameId,
        createdAt: new Date().toISOString(),
        turns: this.turnsArray
      };
      fs.writeFileSync(this.turnLogPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`[LOGGER ERROR] Failed to save turn log: ${err.message}`);
    }
  }

  /**
   * Start a new game
   */
  startNewGame(gameId = null) {
    this.gameId = gameId || `game_${Date.now()}`;
    this.currentTurnNumber = 0;
    this.turnsArray = [];
    this.turnLogPath = path.join(TURN_LOG_DIR, `${this.gameId}.json`);
    this._saveTurnsToFile();
    
    console.log(`[LOGGER] New game started: ${this.gameId}`);
    this.consoleLogger.info({ gameId: this.gameId, sessionId: this.sessionId }, 'New game started');
  }

  /**
   * Start a new turn - call this at the beginning of each search
   */
  startTurn(fen, color, stageInfo) {
    this.currentTurnNumber++;
    this.currentTurnId = generateTurnId(this.currentTurnNumber);
    this.currentStage = stageInfo?.stage || null;
    this.currentSearchId = `search_${this.currentTurnId}`;
    
    // Initialize turn data accumulator
    this.turnData = {
      // Identification
      turnId: this.currentTurnId,
      searchId: this.currentSearchId,
      sessionId: this.sessionId,
      gameId: this.gameId,
      turnNumber: this.currentTurnNumber,
      timestamp: new Date().toISOString(),
      
      // Position
      fen: fen,
      color: color,
      
      // Stage info
      stage: {
        name: stageInfo?.stage || 'unknown',
        fullMoveNumber: stageInfo?.fullMoveNumber || this.currentTurnNumber,
        halfMoveCount: stageInfo?.halfMoveCount || 0,
        materialPhase: stageInfo?.materialPhase || 0,
        phasePercent: stageInfo?.phasePercent || 1,
        priorities: stageInfo?.priorities || [],
        stageReasons: stageInfo?.stageReasons || []
      },
      
      // Will be populated during search
      candidateMoves: [],
      evaluation: {},
      searchStats: {},
      bestMove: null,
      selectedMoveAnalysis: null,
      
      // Cross-references to other logs
      logReferences: {
        searchEntries: [],
        evalEntries: [],
        moveOrderEntries: [],
        ttEntries: []
      },
      
      // Warnings and issues
      warnings: [],
      errors: []
    };
    
    return this.currentTurnId;
  }

  /**
   * Record a candidate move with its evaluation
   */
  recordCandidateMove(move, score, orderScore, evalBreakdown, rank) {
    if (!this.turnData) return;
    
    this.turnData.candidateMoves.push({
      rank: rank,
      move: move.algebraic,
      fromSquare: move.fromSquare,
      toSquare: move.toSquare,
      piece: move.piece,
      score: score,
      orderScore: orderScore,
      
      // Move characteristics
      isCapture: move.capturedPiece !== null,
      capturedPiece: move.capturedPiece,
      isPromotion: move.isPromotion || false,
      promotionPiece: move.promotionPiece,
      
      // Move ordering factors
      orderingFactors: {
        isTTMove: move.isTTMove || false,
        isKiller: move.isKiller || false,
        isCounterMove: move.isCounterMove || false,
        historyScore: move.historyScore || 0,
        scoreBreakdown: move.scoreBreakdown || {}
      },
      
      // Opening analysis if available
      openingAnalysis: move.openingAnalysis || null,
      
      // Evaluation breakdown for position after this move
      evalBreakdown: evalBreakdown || null
    });
  }

  /**
   * Record the selected best move and finalize turn data
   */
  finalizeTurn(bestMove, searchResult, evalResult, openingAnalysis = null) {
    if (!this.turnData) {
      console.error('[LOGGER ERROR] finalizeTurn called without startTurn');
      return;
    }
    
    // Set best move
    this.turnData.bestMove = {
      move: bestMove?.algebraic || null,
      fromSquare: bestMove?.fromSquare,
      toSquare: bestMove?.toSquare,
      score: searchResult?.score || 0,
      depth: searchResult?.depth || 0,
      source: searchResult?.source || 'search'
    };
    
    // Search statistics
    this.turnData.searchStats = {
      nodes: searchResult?.nodes || 0,
      qNodes: searchResult?.qNodes || 0,
      depth: searchResult?.depth || 0,
      time: searchResult?.time || 0,
      nps: searchResult?.time > 0 ? Math.round((searchResult?.nodes || 0) / (searchResult.time / 1000)) : 0,
      ttHits: searchResult?.stats?.ttHits || 0,
      ttCutoffs: searchResult?.stats?.ttCutoffs || 0,
      nullMoveCutoffs: searchResult?.stats?.nullMoveCutoffs || 0,
      futilityCutoffs: searchResult?.stats?.futilityCutoffs || 0,
      lmrSearches: searchResult?.stats?.lmrSearches || 0,
      lmrResearches: searchResult?.stats?.lmrResearches || 0
    };
    
    // Evaluation breakdown
    this.turnData.evaluation = {
      total: evalResult?.score || 0,
      breakdown: evalResult?.breakdown || {},
      gamePhase: evalResult?.context?.gamePhase || 1
    };
    
    // Principal variation
    this.turnData.pv = searchResult?.pv?.map(m => m.algebraic) || [];
    
    // Opening analysis
    if (openingAnalysis) {
      this.turnData.openingAnalysis = {
        isOpening: openingAnalysis.isOpening,
        violations: openingAnalysis.violations || [],
        bonuses: openingAnalysis.bonuses || [],
        totalPenalty: openingAnalysis.totalPenalty || 0,
        totalBonus: openingAnalysis.totalBonus || 0
      };
      
      // Add violations to warnings
      if (openingAnalysis.violations?.length > 0) {
        for (const v of openingAnalysis.violations) {
          this.turnData.warnings.push({
            type: 'opening_violation',
            principle: v.principle,
            description: v.description,
            severity: v.severity,
            penalty: v.penalty
          });
        }
      }
    }
    
    // Selected move analysis - detailed breakdown of why this move was chosen
    const selectedCandidate = this.turnData.candidateMoves.find(
      m => m.move === bestMove?.algebraic
    );
    
    if (selectedCandidate) {
      this.turnData.selectedMoveAnalysis = {
        rank: selectedCandidate.rank,
        scoreVsSecond: this.turnData.candidateMoves.length > 1 
          ? selectedCandidate.score - this.turnData.candidateMoves[1]?.score 
          : null,
        orderScoreBreakdown: selectedCandidate.orderingFactors,
        competingMoves: this.turnData.candidateMoves.slice(0, 5).map(m => ({
          move: m.move,
          score: m.score,
          scoreDiff: selectedCandidate.score - m.score
        }))
      };
    }
    
    // Sort candidate moves by score for easy analysis
    this.turnData.candidateMoves.sort((a, b) => b.score - a.score);
    
    // Assign final ranks
    this.turnData.candidateMoves.forEach((m, idx) => {
      m.finalRank = idx + 1;
    });
    
    // Add to turns array and save
    this.turnsArray.push(this.turnData);
    this._saveTurnsToFile();
    
    // Log summary to console
    console.log(`[TURN ${this.currentTurnNumber}] ${bestMove?.algebraic || 'null'} (score: ${searchResult?.score}, depth: ${searchResult?.depth}, stage: ${this.turnData.stage.name})`);
    
    // Clear turn data
    const completedTurnId = this.currentTurnId;
    this.turnData = null;
    
    return completedTurnId;
  }

  /**
   * Add a warning to current turn
   */
  addTurnWarning(type, message, details = {}) {
    if (this.turnData) {
      this.turnData.warnings.push({
        type,
        message,
        details,
        timestamp: new Date().toISOString()
      });
    }
    console.warn(`[TURN WARNING] ${type}: ${message}`);
  }

  /**
   * Add an error to current turn and escalate to console
   */
  addTurnError(type, message, details = {}) {
    if (this.turnData) {
      this.turnData.errors.push({
        type,
        message,
        details,
        timestamp: new Date().toISOString()
      });
    }
    console.error(`[TURN ERROR] ${type}: ${message}`);
    if (details.stack) {
      console.error(details.stack);
    }
  }

  /**
   * Add a log reference for cross-referencing
   */
  addLogReference(category, entryId) {
    if (!this.turnData) return;
    
    const categoryName = CATEGORY_NAMES[category] || 'unknown';
    const refArray = `${categoryName}Entries`;
    
    if (this.turnData.logReferences[refArray]) {
      this.turnData.logReferences[refArray].push(entryId);
    }
  }

  // ========== Standard Category Logging ==========

  setEnabledCategories(mask) {
    this.enabledMask = mask;
    console.log(`[LOGGER] Categories enabled: ${this._getMaskDescription(mask)}`);
  }

  enable(...categories) {
    for (const cat of categories) {
      this.enabledMask |= cat;
    }
  }

  disable(...categories) {
    for (const cat of categories) {
      this.enabledMask &= ~cat;
    }
  }

  isEnabled(category) {
    return (this.enabledMask & category) !== 0;
  }

  _getMaskDescription(mask) {
    const enabled = [];
    for (const [cat, name] of Object.entries(CATEGORY_NAMES)) {
      if (mask & parseInt(cat)) {
        enabled.push(name);
      }
    }
    return enabled.length > 0 ? enabled.join(', ') : 'none';
  }

  /**
   * Core log method with error escalation
   */
  log(category, level, data, message) {
    // Always escalate errors to console
    if (level === 'error' || level === 'fatal') {
      console.error(`[${CATEGORY_NAMES[category]?.toUpperCase() || 'LOG'} ERROR] ${message}`);
      if (data.error) console.error(`  Error: ${data.error}`);
      if (data.stack) console.error(`  Stack: ${data.stack}`);
      
      // Add to turn errors if in a turn
      this.addTurnError(CATEGORY_NAMES[category] || 'unknown', message, data);
    }
    
    // Also escalate warnings to console
    if (level === 'warn') {
      console.warn(`[${CATEGORY_NAMES[category]?.toUpperCase() || 'LOG'} WARN] ${message}`);
    }
    
    if (!this.isEnabled(category)) return;
    
    // Enrich with context
    const enrichedData = {
      ...data,
      turnId: this.currentTurnId,
      searchId: this.currentSearchId,
      turnNumber: this.currentTurnNumber,
      stage: this.currentStage,
      sessionId: this.sessionId,
      gameId: this.gameId
    };
    
    const logger = this.loggers.get(category);
    if (logger) {
      logger[level](enrichedData, message);
    }
  }

  // Category convenience methods
  search(level, data, message) {
    this.log(LOG_CATEGORY.SEARCH, level, data, message);
  }

  eval(level, data, message) {
    this.log(LOG_CATEGORY.EVAL, level, data, message);
  }

  moveOrder(level, data, message) {
    this.log(LOG_CATEGORY.MOVE_ORDER, level, data, message);
  }

  tt(level, data, message) {
    this.log(LOG_CATEGORY.TT, level, data, message);
  }

  uci(level, data, message) {
    this.log(LOG_CATEGORY.UCI, level, data, message);
  }

  book(level, data, message) {
    this.log(LOG_CATEGORY.BOOK, level, data, message);
  }

  heuristics(level, data, message) {
    this.log(LOG_CATEGORY.HEURISTICS, level, data, message);
  }

  moves(level, data, message) {
    this.log(LOG_CATEGORY.MOVES, level, data, message);
  }

  pv(level, data, message) {
    this.log(LOG_CATEGORY.PV, level, data, message);
  }

  time(level, data, message) {
    this.log(LOG_CATEGORY.TIME, level, data, message);
  }

  stage(level, data, message) {
    this.log(LOG_CATEGORY.STAGE, level, data, message);
    
    // Also log to stage-specific file
    if (data.stage && this.stageLoggers.has(data.stage)) {
      const stageLogger = this.stageLoggers.get(data.stage);
      stageLogger[level]({
        ...data,
        turnId: this.currentTurnId,
        turnNumber: this.currentTurnNumber
      }, message);
    }
  }

  // ========== Specialized Logging Methods ==========

  searchNode(data) {
    if (!this.isEnabled(LOG_CATEGORY.SEARCH)) return;
    
    const entryId = `sn_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    
    const logger = this.loggers.get(LOG_CATEGORY.SEARCH);
    logger.trace({
      entryId,
      turnId: this.currentTurnId,
      searchId: this.currentSearchId,
      turnNumber: this.currentTurnNumber,
      stage: this.currentStage,
      ...data
    }, `Search node: depth=${data.depth} ply=${data.ply}`);
    
    this.addLogReference(LOG_CATEGORY.SEARCH, entryId);
  }

  moveOrderingDecision(moves, ply, context) {
    if (!this.isEnabled(LOG_CATEGORY.MOVE_ORDER)) return;
    
    const entryId = `mo_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    
    const logger = this.loggers.get(LOG_CATEGORY.MOVE_ORDER);
    logger.debug({
      entryId,
      turnId: this.currentTurnId,
      searchId: this.currentSearchId,
      turnNumber: this.currentTurnNumber,
      stage: this.currentStage,
      ply,
      moveCount: moves.length,
      topMoves: moves.slice(0, 5).map(m => ({
        move: m.algebraic,
        score: m.orderScore,
        breakdown: m.scoreBreakdown,
        isKiller: m.isKiller,
        isCapture: !!m.capturedPiece,
        isPromotion: m.isPromotion,
        isTTMove: m.isTTMove,
        isCounterMove: m.isCounterMove,
        historyScore: m.historyScore
      })),
      ...context
    }, `Move ordering at ply ${ply}: ${moves.length} moves`);
    
    this.addLogReference(LOG_CATEGORY.MOVE_ORDER, entryId);
  }

  evalBreakdown(position, breakdown, total) {
    if (!this.isEnabled(LOG_CATEGORY.EVAL)) return;
    
    const entryId = `ev_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    
    const logger = this.loggers.get(LOG_CATEGORY.EVAL);
    logger.debug({
      entryId,
      turnId: this.currentTurnId,
      searchId: this.currentSearchId,
      turnNumber: this.currentTurnNumber,
      stage: this.currentStage,
      fen: position,
      breakdown,
      total
    }, `Evaluation: ${total}`);
    
    this.addLogReference(LOG_CATEGORY.EVAL, entryId);
  }

  heuristicCalc(name, color, score, details) {
    if (!this.isEnabled(LOG_CATEGORY.HEURISTICS)) return;
    
    const logger = this.loggers.get(LOG_CATEGORY.HEURISTICS);
    logger.trace({
      turnId: this.currentTurnId,
      searchId: this.currentSearchId,
      turnNumber: this.currentTurnNumber,
      stage: this.currentStage,
      heuristic: name,
      color,
      score,
      ...details
    }, `${name}: ${score} for ${color}`);
  }

  logStageTransition(previousStage, newStage, details) {
    console.log(`[STAGE] Transition: ${previousStage} -> ${newStage}`);
    this.stage('info', {
      previousStage,
      newStage,
      stage: newStage,
      ...details
    }, `Stage transition: ${previousStage} -> ${newStage}`);
  }

  logOpeningViolation(move, violations, bonuses) {
    if (!this.isEnabled(LOG_CATEGORY.STAGE)) return;
    
    const netAdjustment = bonuses.reduce((s, b) => s + b.bonus, 0) + 
                          violations.reduce((s, v) => s + v.penalty, 0);
    
    console.warn(`[OPENING] ${move.algebraic}: ${violations.length} violations (net: ${netAdjustment})`);
    
    this.stage('warn', {
      stage: GAME_STAGE.OPENING,
      move: move.algebraic,
      violations,
      bonuses,
      netAdjustment
    }, `Opening principles: ${violations.length} violations, ${bonuses.length} bonuses`);
  }

  // ========== Utility Methods ==========

  async flush() {
    const flushPromises = [];
    
    for (const logger of this.loggers.values()) {
      flushPromises.push(new Promise(resolve => {
        logger.flush(resolve);
      }));
    }
    
    for (const logger of this.stageLoggers.values()) {
      flushPromises.push(new Promise(resolve => {
        logger.flush(resolve);
      }));
    }
    
    await Promise.all(flushPromises);
    
    // Save final turn log
    this._saveTurnsToFile();
  }

  clearLogs() {
    // Clear category logs
    for (const filename of Object.values(CATEGORY_FILES)) {
      const logPath = path.join(LOG_DIR, filename);
      if (fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, '');
      }
    }
    
    // Clear stage logs
    const stageDir = path.join(LOG_DIR, 'stages');
    for (const filename of Object.values(STAGE_FILES)) {
      const logPath = path.join(stageDir, filename);
      if (fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, '');
      }
    }
    
    // Clear turn logs
    const turnFiles = fs.readdirSync(TURN_LOG_DIR);
    for (const file of turnFiles) {
      fs.unlinkSync(path.join(TURN_LOG_DIR, file));
    }
    
    // Reset turns array
    this.turnsArray = [];
    this._saveTurnsToFile();
    
    console.log('[LOGGER] All log files cleared');
  }

  /**
   * Get current turn data (for external analysis)
   */
  getCurrentTurnData() {
    return this.turnData ? { ...this.turnData } : null;
  }

  /**
   * Get all turns for current game
   */
  getAllTurns() {
    return [...this.turnsArray];
  }

  /**
   * Export turns to a specific file
   */
  exportTurns(filePath) {
    const data = {
      sessionId: this.sessionId,
      gameId: this.gameId,
      exportedAt: new Date().toISOString(),
      turns: this.turnsArray
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`[LOGGER] Turns exported to ${filePath}`);
  }
}

// Singleton instance
const logger = new EngineLogger();
export default logger;
export { LOG_CATEGORY, GAME_STAGE };