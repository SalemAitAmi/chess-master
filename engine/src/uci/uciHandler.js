/**
 * UCI protocol handler — one per engine instance.
 *
 * CONFIG has exactly one path: applyOptions() → ConfigState.apply() → _commit().
 *   setoption name X value Y          standard; silent on success
 *   setoptions k=v k=v …              batch; atomic; replies
 *       optionsok <cfgHash> k=<effective> …   |   optionserror <name> <reason>
 * Profiles and option defaults are advertised once, in the `uci` reply.
 *
 * Extensions: validate, legalmoves, makemove, undomove, gamestate, eval,
 * validatefen, clearlogs, showstage, whoami, smpbench.
 */
import { Board } from '../core/board.js';
import { validateFen } from '../core/fen.js';
import { SearchEngine } from '../search/search.js';
import { SmpCoordinator } from '../search/smpCoordinator.js';
import { hrNow } from '../search/lazySMP.js';
import { generateAllLegalMoves, isInCheck } from '../core/moveGeneration.js';
import { loadOpeningBook, lookupAllBookMoves, isBookLoaded } from '../book/openingBook.js';
import { squareToIndex } from '../core/bitboard.js';
import { PIECES, PIECE_VALUES, PIECE_CHARS, WHITE_IDX, BLACK_IDX } from '../core/constants.js';
import { Evaluator } from '../evaluation/evaluate.js';
import { detectGameStage, getStagePriorities } from '../utils/gameStage.js';
import {
  ConfigState, APPLY, SMP_STRATEGIES, formatUciOptions, formatProfileLines, profileInfo,
  findOption, parseValue,
} from '../config/index.js';
import logger, { LOG, CAT, LogContext } from '../logging/logger.js';
import { parseUCICommand } from './uciParser.js';
import { moveToSan } from './san.js';
const __LOG__ = globalThis.__LOG__ ?? true;
const PROMO_MAP = { q: PIECES.QUEEN, r: PIECES.ROOK, b: PIECES.BISHOP, n: PIECES.KNIGHT };
const HISTORY_WINDOW = 20;
const BLUNDER_CP = 200;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BENCH_FENS = [
  START_FEN,
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
];
export class UCIHandler {
  /**
   * @param {object} opts { instanceId, owner, session, logCtx, profile, options }
   *   profile  profile name (unknown → baseline)
   *   options  { UciName: value } applied at construction (tests, tools)
   */
  constructor(opts = {}) {
    this.instanceId = opts.instanceId ?? 'e0';
    this.owner = opts.owner ?? this.instanceId;
    this.session = opts.session ?? {
      id: 'standalone',
      noteNewGame: () => (__LOG__ ? logger.armGame() : 0),
      describe: () => 'standalone',
    };
    this.logCtx = opts.logCtx ?? new LogContext(this.instanceId);
    this.cfg = new ConfigState(opts.profile ?? 'baseline', {
      LogMask: logger.getMask(), LogSampleRate: logger.getSampleRate(), SmpLog: 'triggered',
    });
    if (opts.options) {
      const r = this.cfg.apply(Object.entries(opts.options));
      if (!r.ok) throw new Error(`UCIHandler: option ${r.name}: ${r.reason}`);
    }
    this.config = this.cfg.engineConfig();
    this.engine = new SearchEngine(this.config, { ownerId: this.owner });
    this.engine.configHash = this.cfg.hash;
    this.smp = new SmpCoordinator(this.config, {
      owner: this.owner, logCtx: this.logCtx, logMode: this.cfg.get('SmpLog'),
    });
    this.evaluator = new Evaluator(this.config);
    this.board = new Board();
    this.rootFen = START_FEN;
    this.debug = false;
    this.searching = false;
    this.moveHistory = [];
    this.initialCounts = this._snapshotCounts();
    this.previousEval = 0;
    if (__LOG__) {
      logger.bind(this.logCtx);
      logger.bindBoard(this.board);
      this._recordConfig('register');
    }
  }
  tableId() {
    const tt = this.engine.tt;
    return tt === null ? 'none' : `${tt.id}@${this.cfg.hash}`;
  }
  // ═══════════════════════════════════════════════════════════════════════
  // Dispatch
  // ═══════════════════════════════════════════════════════════════════════
  async handleCommand(line) {
    if (__LOG__) logger.bind(this.logCtx);
    const cmd = parseUCICommand(line);
    if (__LOG__ && cmd.type === 'go') logger.beginGameIfArmed();
    if (__LOG__ && LOG.uci) logger.event(CAT.UCI, cmd.type, { raw: line });
    switch (cmd.type) {
      case 'uci':         return this.uci();
      case 'debug':       this.debug = cmd.on; return null;
      case 'isready':     return 'readyok';
      case 'setoption': {
        const r = this.applyOptions([[cmd.name, cmd.value]]);
        return r.ok ? null : `info string option error ${r.name} ${r.reason}`;
      }
      case 'setoptions': {
        if (cmd.malformed !== null) return `optionserror ${cmd.malformed} malformed_entry`;
        const r = this.applyOptions(cmd.entries);
        return r.ok
          ? ['optionsok', r.hash, ...r.effective.map(([k, v]) => `${k}=${v}`)].join(' ')
          : `optionserror ${r.name} ${r.reason}`;
      }
      case 'ucinewgame':  return this.newGame();
      case 'position':    return this.position(cmd.fen, cmd.moves);
      case 'go':          return await this.go(cmd);
      case 'stop':        this.engine.stop(); this.smp.stop(); return null;
      case 'quit':        return this.quit();
      case 'validate':    return this.validateMove(cmd.move);
      case 'legalmoves':  return this.getLegalMoves(cmd.square);
      case 'makemove':    return this.makeMove(cmd.move);
      case 'undomove':    return this.undoMove();
      case 'gamestate':   return this.getGameState();
      case 'eval':        return `eval ${this._evalScore()}`;
      case 'validatefen': {
        const v = validateFen(cmd.fen);
        return v.ok ? 'fenvalid true' : `fenvalid false ${v.reason}`;
      }
      case 'clearlogs':   logger.clear(); return 'info string Logs cleared';
      case 'showstage':   return this.showStage();
      case 'whoami':      return this.whoami();
      case 'smpbench':    return await this.smpBench(cmd.depth, cmd.strategies);
      default:
        if (__LOG__ && LOG.uci) logger.event(CAT.UCI, 'unknown', { raw: line, command: cmd.command ?? '' });
        return `info string Unknown command: ${cmd.command ?? ''}`;
    }
  }
  uci() {
    return ['id name ChessMaster Engine 1.0', 'id author Chess Master',
            ...formatUciOptions(this.cfg), ...formatProfileLines(), 'uciok'].join('\n');
  }
  // ═══════════════════════════════════════════════════════════════════════
  // Configuration — the single path
  // ═══════════════════════════════════════════════════════════════════════
  applyOptions(entries) {
    // A search is awaiting (book, SMP collect): reconfiguring under it would
    // hand helpers and the main thread different configs.
    if (this.searching) return { ok: false, name: '*', reason: 'busy' };
    // The trace sample rate is a SESSION invariant (logger.js, SAMPLING). The
    // logger is shared by every instance, so ask it, not this instance's
    // possibly stale mirror of the value.
    for (const [name, raw] of entries) {
      const o = findOption(name);
      if (o === null || o.apply !== APPLY.LOG_SAMPLE) continue;
      const v = parseValue(o, raw);
      if (v !== undefined && !logger.canSetSampleRate(v)) {
        if (__LOG__ && LOG.uci) logger.event(CAT.UCI, 'options-error', { name: o.uci, reason: 'locked_for_session' });
        return { ok: false, name: o.uci, reason: 'locked_for_session' };
      }
    }
    const res = this.cfg.apply(entries);
    if (res.ok) this._commit(res);
    if (__LOG__ && LOG.uci) {
      logger.event(CAT.UCI, res.ok ? 'options' : 'options-error', res.ok
        ? { n: entries.length, cfg: res.hash, profile: this.cfg.profile }
        : { name: res.name, reason: res.reason });
    }
    return res;
  }
  
  _commit(res) {
    const ec = this.cfg.engineConfig();
    this.config = ec;
    const all = res.profileChanged;
    const has = (k) => all || res.changed.has(k);
    if (has(APPLY.SEARCH) || has(APPLY.WEIGHT) || has(APPLY.THREADS)) {
      this.engine.reconfigure(ec);
      this.evaluator = new Evaluator(ec);
    }
    // A profile is a whole config set: a warm table from the previous set
    // would contaminate any comparison between them.
    if (all && this.engine.tt !== null) this.engine.tt.clear();
    if (has(APPLY.THREADS)) this.smp.setThreadCount(ec.threads, this.engine);
    if (res.changed.has(APPLY.LOG_MASK)) logger.setMask(this.cfg.get('LogMask'));
    if (res.changed.has(APPLY.LOG_SAMPLE)) logger.setSampleRate(this.cfg.get('LogSampleRate'));
    if (res.changed.has(APPLY.SMP_LOG)) this.smp.setLogMode(this.cfg.get('SmpLog'));
    this.engine.configHash = this.cfg.hash;
    if (res.identityChanged) this._recordConfig('apply');
  }
  /** instances.ndjson: one record per identity change (rev increments). Analysers keep the last per eng. */
  _recordConfig(reason) {
    if (!__LOG__) return;
    const p = profileInfo(this.cfg.profile);
    logger.sessionRecord('instances.ndjson', {
      session: this.session.id ?? 'standalone', eng: this.instanceId, reason, rev: this.cfg.rev,
      profile: p.name, label: p.label, description: p.description,
      configHash: this.cfg.hash, overrides: this.cfg.overrides(),
      tt: this.tableId(), ttOwner: this.owner, config: this.config,
    });
    logger.write(`[CONFIG] ${this.owner} ${reason} rev=${this.cfg.rev} profile=${p.name} cfg=${this.cfg.hash}`);
  }
  // ═══════════════════════════════════════════════════════════════════════
  // Game lifecycle
  // ═══════════════════════════════════════════════════════════════════════
  newGame() {
    this.board = new Board();
    this.rootFen = START_FEN;
    if (__LOG__) logger.bindBoard(this.board);
    this.moveHistory = [];
    this.initialCounts = this._snapshotCounts();
    this.previousEval = 0;
    if (this.engine.tt !== null) this.engine.tt.clear();
    this.engine.moveOrderer.clear();
    this.smp.newGame();
    this.session.noteNewGame(this.instanceId);
    return null;
  }
  position(fen, moves) {
    let rootFen = START_FEN;
    if (fen) {
      const v = validateFen(fen);
      if (!v.ok) {
        if (__LOG__) logger.event(CAT.UCI, 'invalid-fen', { raw: fen, reason: v.reason });
        return `info string error invalid_fen ${v.reason}`;
      }
      rootFen = v.fen;
    }
    this.board = Board.fromFen(rootFen);
    this.rootFen = rootFen;
    if (__LOG__) logger.bindBoard(this.board);
    this.moveHistory = [];
    this.initialCounts = this._snapshotCounts();
    this.previousEval = 0;
    for (const m of moves) {
      if (this._applyMove(m) === null) {
        if (__LOG__ && LOG.uci) logger.event(CAT.UCI, 'illegal-move', { raw: m, fen: this.board.toFen() });
        break;
      }
    }
    return null;
  }
  quit() { this.smp.terminate(this.engine); this.engine.dispose(); return 'quit'; }
  // ═══════════════════════════════════════════════════════════════════════
  // Search
  // ═══════════════════════════════════════════════════════════════════════
  async go(options) {
    if (this.searching) return null;
    this.searching = true;
    const responses = [];
    try {
      const legalMoves = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
      if (legalMoves.length === 0) return 'bestmove (none)';
      const bookHints = await this._bookHintsFor(legalMoves, responses);
      if (__LOG__) logger.bind(this.logCtx);
      // MaxDepth is a CEILING: `go depth N` from the client used to bypass it.
      const depth = Math.min(options.depth || this.config.maxDepth, this.config.maxDepth);
      const savedMaxTime = this.engine.config.maxSearchTime;
      if (options.movetime) this.engine.config.maxSearchTime = options.movetime;
      let result;
      try { result = await this._search(depth, bookHints, legalMoves, responses); }
      finally { this.engine.config.maxSearchTime = savedMaxTime; }
      if (__LOG__) logger.bind(this.logCtx);
      this._formatSearchResult(result, bookHints, responses);
    } catch (err) {
      if (__LOG__) logger.bind(this.logCtx);
      logger.event(CAT.UCI, 'error', { error: err.message, stack: err.stack });
      responses.push(`info string Error: ${err.message}`, 'bestmove (none)');
    } finally {
      this.searching = false;
    }
    return responses.join('\n');
  }
  async _search(depth, bookHints, legalMoves, responses) {
    const gate = this.smp.canRun(this.engine.config);
    if (!gate.ok) {
      if (this.smp.holdsTable(this.engine)) this.smp.release(this.engine, `inactive: ${gate.reason}`);
      if (this.smp.isMultiThreaded()) responses.push(`info string SMP inactive (${gate.reason}); single-threaded`);
      return this.engine.search(this.board, depth, { bookHints });
    }
    try {
      return await this.smp.search({
        engine: this.engine, board: this.board, depth, bookHints, legalMoves,
        rootFen: this.rootFen, moves: this.moveHistory.map(m => m.uci),
        config: { ...this.engine.config }, logCtx: this.logCtx,
      });
    } catch (err) {
      if (err.smpPhase !== 'prepare') throw err;
      if (__LOG__) logger.bind(this.logCtx);
      if (__LOG__ && LOG.smp) logger.event(CAT.SMP, 'smp-fallback', { error: err.message });
      responses.push(`info string SMP unavailable (${err.message}); single-threaded`);
      return this.engine.search(this.board, depth, { bookHints });
    }
  }
  /** loadOpeningBook() is memoised, so enabling OwnBook at runtime now actually loads it. */
  async _bookHintsFor(legalMoves, responses) {
    if (!this.config.useOpeningBook) return null;
    await loadOpeningBook();
    if (!isBookLoaded()) return null;
    const hints = lookupAllBookMoves(this.board, legalMoves);
    if (hints !== null) responses.push(`info string Book: ${hints.size} hint(s)`);
    return hints;
  }
  _formatSearchResult(result, bookHints, responses) {
    let best = result.bestMove;
    if (best === null) {
      const legal = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
      if (legal.length > 0) {
        best = legal[0];
        responses.push(`info string search produced no move (aborted after ${result.time}ms); playing first legal move`);
        logger.event(CAT.UCI, 'no-root-move', { ms: result.time, depth: result.depth, fen: this.board.toFen() });
      }
    }
    const bestAlg = best !== null ? best.algebraic : '(none)';
    if (bookHints !== null && best !== null) {
      responses.push(`info string Book ${bookHints.has(bestAlg) ? 'confirmed' : 'OVERRIDDEN'} (${bestAlg} cp=${result.score})`);
    }
    if (result.smp) {
      const s = result.smp;
      responses.push(`info string smp ${s.strategy} threads ${s.threads} pick ${s.pick} (${s.reason}) ` +
                     `agree ${s.agree}/${s.considered} errors ${s.errors}${s.earlyStop ? ' earlystop' : ''}`);
    }
    const nps = result.time > 0 ? Math.round(result.nodes * 1000 / result.time) : 0;
    const pv = result.pv.map(m => m.algebraic).join(' ');
    responses.push(`info depth ${result.depth} seldepth ${result.seldepth} nodes ${result.nodes} nps ${nps} ` +
                   `time ${result.time} score cp ${result.score} pv ${pv}`);
    responses.push(`bestmove ${bestAlg}`);
  }
  /** smpbench — see docs/SMP_STRATEGIES.md. Unchanged except for the config source. */
  async smpBench(depth, strategies) {
    if (this.searching) return 'info string smpbench: engine busy';
    if (!this.smp.isMultiThreaded()) return 'info string smpbench: set Threads > 1 first';
    const list = ['single', ...(strategies?.length ? strategies : SMP_STRATEGIES)
      .filter(s => s !== 'single' && SMP_STRATEGIES.includes(s))];
    this.searching = true;
    const saved = { board: this.board, rootFen: this.rootFen, moveHistory: this.moveHistory,
                    initialCounts: this.initialCounts, strategy: this.engine.config.smpStrategy };
    const rows = [];
    try {
      for (const strategy of list) {
        this.engine.config.smpStrategy = strategy;
        const row = { strategy, ms: 0, nodes: 0, overheadMs: 0, barrierMs: 0, depth: 0, moves: [], error: null };
        try {
          if (strategy !== 'single') await this.smp.prepare(this.engine, this.engine.config);
          for (const fen of BENCH_FENS) {
            this.board = Board.fromFen(fen);
            this.rootFen = fen;
            this.moveHistory = [];
            if (this.engine.tt !== null) this.engine.tt.clear();
            this.smp.clearTable();
            this.engine.moveOrderer.clear();
            this.smp.newGame();
            const legal = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
            const t0 = hrNow();
            const r = await this._search(depth, null, legal, []);
            row.ms += hrNow() - t0;
            row.nodes += r.nodes;
            row.depth += r.depth;
            row.overheadMs += r.smp?.timing?.overheadMs ?? 0;
            row.barrierMs += r.smp?.timing?.barrierMs ?? 0;
            row.moves.push(r.bestMove !== null ? r.bestMove.algebraic : '-');
          }
        } catch (err) { row.error = err.message; }
        rows.push(row);
      }
    } finally {
      Object.assign(this, { board: saved.board, rootFen: saved.rootFen,
                            moveHistory: saved.moveHistory, initialCounts: saved.initialCounts });
      this.engine.config.smpStrategy = saved.strategy;
      if (__LOG__) { logger.bind(this.logCtx); logger.bindBoard(this.board); }
      this.searching = false;
    }
    const base = rows[0];
    const threads = 1 + this.smp.helperBudget();
    const lines = [`info string smpbench depth ${depth} positions ${BENCH_FENS.length} threads ${threads}`];
    for (const r of rows) {
      if (r.error !== null) { lines.push(`info string bench ${r.strategy} error ${r.error}`); continue; }
      const t = r.strategy === 'single' ? 1 : threads;
      const speedup = r.ms > 0 ? base.ms / r.ms : 0;
      const f = {
        strategy: r.strategy, threads: t, ms: Math.round(r.ms), speedup: +speedup.toFixed(2),
        eff: +(speedup / t).toFixed(2), nodes: r.nodes,
        nodeRatio: base.nodes > 0 ? +(r.nodes / base.nodes).toFixed(2) : null,
        nps: r.ms > 0 ? Math.round(r.nodes * 1000 / r.ms) : 0,
        overheadMs: Math.round(r.overheadMs), barrierMs: Math.round(r.barrierMs),
        avgDepth: +(r.depth / BENCH_FENS.length).toFixed(1),
        agree: `${r.moves.filter((m, i) => m === base.moves[i]).length}/${r.moves.length}`,
      };
      lines.push('info string bench ' + Object.entries(f).map(([k, v]) => `${k} ${v}`).join(' '));
      if (__LOG__ && LOG.smp) logger.event(CAT.SMP, 'smp-bench', { depth, ...f });
    }
    lines.push('info string smpbench done');
    return lines.join('\n');
  }
  // ═══════════════════════════════════════════════════════════════════════
  // Diagnostics
  // ═══════════════════════════════════════════════════════════════════════
  showStage() {
    const s = detectGameStage(this.board);
    return [`info string Stage: ${s.stage}`,
            `info string Move: ${s.fullMoveNumber} (ply ${s.halfMoveCount})`,
            `info string Phase: ${(s.phasePercent * 100).toFixed(1)}%`,
            `info string Priorities: ${getStagePriorities(s.stage).join(', ')}`].join('\n');
  }
  whoami() {
    const ov = Object.entries(this.cfg.overrides()).map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
    return [`info string instance ${this.instanceId} owner ${this.owner}`,
            `info string profile ${this.cfg.profile} cfg ${this.cfg.hash} rev ${this.cfg.rev}`,
            `info string overrides ${ov}`,
            `info string tt ${this.tableId()}`,
            `info string smp ${this.smp.describe()}`,
            `info string session ${this.session.describe()}`].join('\n');
  }
  // ═══════════════════════════════════════════════════════════════════════
  // Interactive extensions (unchanged behaviour)
  // ═══════════════════════════════════════════════════════════════════════
  validateMove(moveStr) {
    if (!moveStr || moveStr.length < 4) return 'valid false invalid_format';
    const from = squareToIndex(moveStr.slice(0, 2));
    const to = squareToIndex(moveStr.slice(2, 4));
    if (from === -1 || to === -1) return 'valid false invalid_squares';
    const promoChar = moveStr.length > 4 ? moveStr[4].toLowerCase() : null;
    if (promoChar !== null && !(promoChar in PROMO_MAP)) return 'valid false invalid_promotion';
    const wanted = promoChar !== null ? PROMO_MAP[promoChar] : null;
    const candidates = this._candidates(from, to);
    if (candidates.length === 0) {
      if (this.board.pieceList[from] === PIECES.NONE) return 'valid false no_piece';
      const owner = this.board.bbSide[WHITE_IDX].getBit(from) ? 'white' : 'black';
      if (owner !== this.board.gameState.activeColor) return 'valid false wrong_color';
      return 'valid false illegal_move';
    }
    if (!candidates[0].isPromotion) return promoChar !== null ? 'valid false unexpected_promotion' : 'valid true';
    if (wanted === null) return 'valid true needs_promotion';
    return candidates.some(m => m.promotionPiece === wanted) ? 'valid true' : 'valid false invalid_promotion';
  }
  getLegalMoves(square = null) {
    let moves = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
    if (square) {
      const from = squareToIndex(square);
      if (from === -1) return 'legalmoves none invalid_square';
      moves = moves.filter(m => m.fromSquare === from);
    }
    return moves.length === 0 ? 'legalmoves none' : 'legalmoves ' + moves.map(m => m.algebraic).join(' ');
  }
  makeMove(moveStr) {
    const v = this.validateMove(moveStr);
    if (v !== 'valid true') {
      return `error ${v.startsWith('valid true ') ? v.slice('valid true '.length) : v.slice('valid false '.length)}`;
    }
    return this._applyMove(moveStr) !== null ? this.getGameState() : 'error illegal_move';
  }
  undoMove() {
    if (this.board.plyCount === 0) return 'error no_moves_to_undo';
    this.board.undoMove();
    this.moveHistory.pop();
    return this.getGameState();
  }
  getGameState() {
    const gs = this.board.gameState;
    const legalMoves = generateAllLegalMoves(this.board, gs.activeColor);
    const inCheck = isInCheck(this.board, gs.activeColor);
    let status = 'ongoing', winner = 'none';
    if (legalMoves.length === 0) {
      if (inCheck) { status = 'checkmate'; winner = gs.activeColor === 'white' ? 'black' : 'white'; }
      else { status = 'stalemate'; winner = 'draw'; }
    } else if (gs.halfMoveClock >= 100)      { status = 'fifty_move'; winner = 'draw'; }
    else if (this.board.isRepetition(3))     { status = 'threefold'; winner = 'draw'; }
    else if (this._isInsufficientMaterial()) { status = 'insufficient_material'; winner = 'draw'; }
    const material = this._countMaterial();
    const currentEval = this._evalScore();
    const last = this.moveHistory.length > 0 ? this.moveHistory[this.moveHistory.length - 1] : null;
    const diff = currentEval - this.previousEval;
    const blunder = last !== null && ((last.color === 'white' && diff < -BLUNDER_CP) ||
                                      (last.color === 'black' && diff > BLUNDER_CP));
    const lines = [
      `fen ${this.board.toFen()}`, `turn ${gs.activeColor}`, `fullmove ${gs.fullMoveCount}`,
      `halfmove ${gs.halfMoveClock}`, `status ${status}`, `winner ${winner}`, `incheck ${inCheck}`,
      `legalmovecount ${legalMoves.length}`, `eval ${currentEval}`,
      `material_white ${material.white}`, `material_black ${material.black}`,
      `material_diff ${material.white - material.black}`,
      `captured_white ${this._capturedString(WHITE_IDX)}`, `captured_black ${this._capturedString(BLACK_IDX)}`,
      `movecount ${this.moveHistory.length}`, `canundo ${this.board.plyCount > 0}`,
      `blunder ${blunder}`, `repetitions ${this.board.countRepetitions()}`,
    ];
    if (last !== null) {
      lines.push(`lastmove ${last.uci}`, `lastmovesan ${last.san}`, `lastpiece ${PIECE_CHARS[last.piece]}`,
                 `lastcaptured ${last.captured !== null ? PIECE_CHARS[last.captured] : 'none'}`);
    }
    const w = this.moveHistory.slice(-HISTORY_WINDOW);
    lines.push(`history ${w.map(m => m.san).join(' ') || 'none'}`, `historyuci ${w.map(m => m.uci).join(' ') || 'none'}`);
    return lines.join('\n');
  }
  _candidates(from, to) {
    return generateAllLegalMoves(this.board, this.board.gameState.activeColor)
      .filter(m => m.fromSquare === from && m.toSquare === to);
  }
  _applyMove(moveStr) {
    const from = squareToIndex(moveStr.slice(0, 2));
    const to = squareToIndex(moveStr.slice(2, 4));
    if (from === -1 || to === -1) return null;
    const promoChar = moveStr.length > 4 ? moveStr[4].toLowerCase() : null;
    const wanted = promoChar !== null ? PROMO_MAP[promoChar] : null;
    const legal = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
    const cands = legal.filter(m => m.fromSquare === from && m.toSquare === to);
    const move = wanted !== null ? cands.find(m => m.promotionPiece === wanted)
      : (cands.find(m => !m.isPromotion) ?? cands.find(m => m.promotionPiece === PIECES.QUEEN));
    if (move === undefined) return null;
    const san = moveToSan(this.board, move, legal);
    const color = this.board.gameState.activeColor;
    this.previousEval = this._evalScore();
    this.board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
    this.moveHistory.push({ uci: move.algebraic, san, piece: move.piece, captured: move.capturedPiece, color });
    return move;
  }
  _snapshotCounts() {
    const counts = [new Int8Array(6), new Int8Array(6)];
    for (const idx of [WHITE_IDX, BLACK_IDX]) {
      for (let p = PIECES.KING; p <= PIECES.PAWN; p++) counts[idx][p] = this.board.bbPieces[idx][p].popCount();
    }
    return counts;
  }
  _capturedString(colorIdx) {
    const init = this.initialCounts[colorIdx], bb = this.board.bbPieces[colorIdx];
    const out = [];
    let promoted = 0;
    for (let p = PIECES.QUEEN; p <= PIECES.KNIGHT; p++) promoted += Math.max(0, bb[p].popCount() - init[p]);
    for (let p = PIECES.QUEEN; p <= PIECES.KNIGHT; p++) for (let n = init[p] - bb[p].popCount(); n > 0; n--) out.push(p);
    for (let n = init[PIECES.PAWN] - bb[PIECES.PAWN].popCount() - promoted; n > 0; n--) out.push(PIECES.PAWN);
    return out.length === 0 ? 'none' : out.map(p => PIECE_CHARS[p].toLowerCase()).join('');
  }
  _evalScore() { return this.evaluator.evaluate(this.board, 'white').score; }
  _isInsufficientMaterial() {
    for (const idx of [WHITE_IDX, BLACK_IDX]) {
      const bb = this.board.bbPieces[idx];
      if (bb[PIECES.PAWN].popCount() || bb[PIECES.ROOK].popCount() || bb[PIECES.QUEEN].popCount()) return false;
    }
    const minors = idx => this.board.bbPieces[idx][PIECES.BISHOP].popCount() + this.board.bbPieces[idx][PIECES.KNIGHT].popCount();
    return minors(WHITE_IDX) <= 1 && minors(BLACK_IDX) <= 1;
  }
  _countMaterial() {
    const total = idx => {
      let s = 0;
      for (let p = PIECES.QUEEN; p <= PIECES.PAWN; p++) s += this.board.bbPieces[idx][p].popCount() * PIECE_VALUES[p];
      return s;
    };
    return { white: total(WHITE_IDX), black: total(BLACK_IDX) };
  }
}
export default UCIHandler;