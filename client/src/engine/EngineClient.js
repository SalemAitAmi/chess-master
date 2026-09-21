/**
 * UCI Engine Client for communicating with the backend engine server.
 *
 * ONE CLIENT = ONE SOCKET = ONE ENGINE INSTANCE. The server gives every
 * connection its own UCIHandler, SearchEngine and transposition table. A
 * multi-engine page opens one client per engine and identifies them with the
 * `session` handshake:
 *
 *     session <sessionId> <instanceName> [profileName]
 *
 * The handshake is sent as the first frame after `open`, before any UCI
 * traffic. It is not a UCI command — it selects WHICH engine you are talking
 * to, exactly like choosing which engine binary a GUI launches.
 *
 * ── COMMAND SERIALIZATION ────────────────────────────────────────────────
 * Every method that touches the wire goes through `_enqueue`, which runs tasks
 * one at a time on a private promise chain. The three response slots
 * (simple / multi-line / search) are therefore occupied by at most one request
 * each, at all times, BY CONSTRUCTION.
 *
 * This replaces the old "reject on overlap" policy. That policy assumed no
 * caller could issue a command while the handshake was in flight — false as
 * soon as a second client existed, because the first client's `uciok` flipped
 * `connected` for React while its own `isready` was still outstanding, and the
 * resulting re-render issued `ucinewgame` into a busy slot.
 *
 * ── READINESS ────────────────────────────────────────────────────────────
 * `isConnected()` is true only once `initialize()` has COMPLETED
 * (`handshakeComplete`). Socket-open and even `uciok` are not enough: callers
 * use `isConnected()` as the permission to send commands, so it must not be
 * true while the handshake still owns the wire.
 */
const DEFAULT_SERVER_URL = 'ws://localhost:8080';
const CONNECT_TIMEOUT_MS = 5000;
const COMMAND_TIMEOUT_MS = 10000;
/** Hard ceiling for a search. Above the engine's own 600s MoveTime max. */
const SEARCH_TIMEOUT_MS = 660000;
const MULTILINE_KEYS_BOOL = ['incheck', 'canundo', 'blunder'];
const MULTILINE_KEYS_INT = ['fullmove', 'halfmove', 'legalmovecount', 'eval',
  'material_white', 'material_black', 'material_diff', 'movecount', 'repetitions'];

export class EngineClient {
  constructor(serverUrl = DEFAULT_SERVER_URL, opts = {}) {
    // ── Connection ──
    this.serverUrl = serverUrl;
    this.ws = null;
    this.connected = false;          // socket open
    this.ready = false;              // uciok seen
    this.handshakeComplete = false;  // initialize() returned
    // ── Engine instance identity ──
    this.session = opts.session || 'default';
    this.instance = opts.instance || 'e0';
    this.profile = opts.profile || 'baseline';
    /** Parsed from `option name Profile type combo ... var <name>`. */
    this.availableProfiles = [];
    /** Parsed from every `option name ...` line: name -> {type,def,min,max,vars}. */
    this.availableOptions = new Map();
    // ── Pending response slots ──
    this.pendingSimpleResponse = null;
    this.pendingSearchResponse = null;
    this.pendingMultiLineResponse = null;
    // ── Wire serialization ──
    this._chain = Promise.resolve();
    // ── Callbacks ──
    this.onInfo = null;
    this.onBestMove = null;
    this.onConnectionChange = null;
    this.onError = null;
    this.onGameState = null;
  }

  get label() { return `${this.session}/${this.instance}`; }

  // ═══════════════════════════════════════════════════════════════════════
  // CONNECTION LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════
  async connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settleReject = (err) => { if (!settled) { settled = true; reject(err); } };
      const settleResolve = () => { if (!settled) { settled = true; resolve(); } };

      try {
        this.ws = new WebSocket(this.serverUrl);
      } catch (err) {
        settleReject(err);
        return;
      }

      this.ws.onopen = () => {
        this.connected = true;
        console.log(`[${this.label}] socket open`);
        // Claim an engine instance before any UCI traffic. Sent raw (not via
        // the queue): it must be the first frame on the wire, and the server
        // answers it with an `info string`, which no slot is waiting for.
        try {
          this.ws.send(`session ${this.session} ${this.instance} ${this.profile}`);
        } catch (err) {
          console.warn(`[${this.label}] handshake failed:`, err);
        }
        settleResolve();
      };

      this.ws.onmessage = (event) => { this.handleMessage(event.data); };

      this.ws.onerror = (error) => {
        console.error(`[${this.label}] WebSocket error:`, error);
        if (this.onError) this.onError(error);
        if (!this.connected) settleReject(new Error('Failed to connect to engine server'));
      };

      this.ws.onclose = (event) => {
        const wasUsable = this.isConnected();
        this.connected = false;
        this.ready = false;
        this.handshakeComplete = false;
        console.log(`[${this.label}] disconnected`, event.code, event.reason);
        this._rejectAllPending(new Error('Connection closed'));
        // A fresh chain: queued tasks belonging to the dead socket are done.
        this._chain = Promise.resolve();
        if (wasUsable) this._notifyConnectionChange(false);
        settleReject(new Error('Connection closed before open'));
      };

      setTimeout(() => {
        if (!this.connected) {
          if (this.ws) this.ws.close();
          settleReject(new Error('Connection timeout'));
        }
      }, CONNECT_TIMEOUT_MS);
    });
  }

  disconnect() {
    if (!this.ws) return;
    // Unwind every awaiting caller FIRST. Without this, a page teardown left
    // the Colosseum move chain parked on a promise that only the server's
    // close frame could settle.
    this._rejectAllPending(new Error(`[${this.label}] client disconnecting`));
    if (this.connected) {
      try { this.ws.send('quit'); } catch (e) { /* ignore during teardown */ }
    }
    this.ws.onopen = null;
    this.ws.onmessage = null;
    this.ws.onerror = null;
    this.ws.onclose = null;
    try { this.ws.close(1000, 'client teardown'); } catch (e) { /* ignore */ }
    this.ws = null;
    this.connected = false;
    this.ready = false;
    this.handshakeComplete = false;
    this._chain = Promise.resolve();
  }

  isConnected() {
    return this.connected && this.ready && this.handshakeComplete &&
           this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  isSearching() { return this.pendingSearchResponse !== null; }

  _notifyConnectionChange(isConnected) {
    if (this.onConnectionChange) this.onConnectionChange(isConnected);
  }

  _rejectAllPending(error) {
    for (const slot of ['pendingSimpleResponse', 'pendingSearchResponse', 'pendingMultiLineResponse']) {
      const p = this[slot];
      if (p) { this[slot] = null; p.reject(error); }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INBOUND MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════════
  handleMessage(data) {
    const lines = String(data).split('\n');

    // A multi-line command (gamestate / makemove / undomove) owns the next
    // message wholesale.
    if (this.pendingMultiLineResponse) {
      const pending = this.pendingMultiLineResponse;
      this.pendingMultiLineResponse = null;
      let parsed;
      try { parsed = this._parseMultiLineResponse(lines); }
      catch (err) { pending.reject(err); return; }
      if (this.onGameState) this.onGameState(parsed);
      pending.resolve(parsed);
      return;
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      this._routeLine(line);
    }
  }

  _routeLine(line) {
    if (line.startsWith('option name ')) {
      this._parseOptionLine(line);
      return;
    }
    if (line === 'uciok') {
      // NOTE: do NOT notify connection change here. `ready` is necessary but
      // not sufficient; `initialize()` still owns the wire. Notifying here is
      // what let a second client's render pass inject `ucinewgame` into the
      // middle of this client's handshake.
      this.ready = true;
      this._resolveSimple(undefined);
      return;
    }
    if (line === 'readyok') { this._resolveSimple(undefined); return; }
    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const move = parts[1];
      const ponder = parts.length > 3 ? parts[3] : null;
      if (this.onBestMove) this.onBestMove(move, ponder);
      if (this.pendingSearchResponse) {
        const p = this.pendingSearchResponse;
        this.pendingSearchResponse = null;
        p.resolve({ move, ponder });
      }
      return;
    }
    if (line.startsWith('info')) {
      if (this.onInfo) this.onInfo(this.parseInfo(line));
      return;
    }
    if (line.startsWith('valid ')) { this._resolveSimple(this._parseValidateResponse(line)); return; }
    if (line.startsWith('legalmoves ')) { this._resolveSimple(this._parseLegalMovesResponse(line)); return; }
    if (line.startsWith('eval ')) { this._resolveSimple({ eval: parseInt(line.split(' ')[1], 10) }); return; }
    if (line.startsWith('error ')) { this._rejectSimple(new Error(line.slice(6))); return; }
  }

  /**
   * `option name <Name> type <type> [default x] [min a] [max b] [var v ...]`
   * Captured so the settings UI can validate against what the engine actually
   * advertises rather than against a hard-coded mirror.
   */
  _parseOptionLine(line) {
    const parts = line.split(/\s+/);
    // name runs from index 2 until the `type` token (names may contain spaces)
    let i = 2;
    const nameParts = [];
    while (i < parts.length && parts[i] !== 'type') nameParts.push(parts[i++]);
    const name = nameParts.join(' ');
    const opt = { type: null, def: null, min: null, max: null, vars: [] };
    for (; i < parts.length; i++) {
      switch (parts[i]) {
        case 'type':    opt.type = parts[++i]; break;
        case 'default': opt.def = parts[++i]; break;
        case 'min':     opt.min = Number(parts[++i]); break;
        case 'max':     opt.max = Number(parts[++i]); break;
        case 'var':     opt.vars.push(parts[++i]); break;
        default: break;
      }
    }
    if (name) this.availableOptions.set(name, opt);
    if (name === 'Profile' && opt.vars.length > 0) {
      this.availableProfiles = opt.vars.map(n => ({
        name: n,
        label: n.charAt(0).toUpperCase() + n.slice(1),
      }));
    }
  }

  _resolveSimple(value) {
    if (!this.pendingSimpleResponse) return;
    const p = this.pendingSimpleResponse;
    this.pendingSimpleResponse = null;
    p.resolve(value);
  }

  _rejectSimple(err) {
    if (!this.pendingSimpleResponse) return;
    const p = this.pendingSimpleResponse;
    this.pendingSimpleResponse = null;
    p.reject(err);
  }

  _parseMultiLineResponse(lines) {
    const first = lines.find(l => l.trim());
    if (first && (first.startsWith('error ') || first.startsWith('valid false'))) {
      throw new Error(first);
    }
    const result = {};
    for (const line of lines) {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) continue;
      const key = line.slice(0, spaceIdx);
      const value = line.slice(spaceIdx + 1);
      if (MULTILINE_KEYS_BOOL.includes(key)) result[key] = value === 'true';
      else if (MULTILINE_KEYS_INT.includes(key)) result[key] = parseInt(value, 10) || 0;
      else if (key === 'captured_white' || key === 'captured_black') {
        result[key] = value === 'none' ? [] : value.split('');
      } else if (key === 'history' || key === 'historyuci') {
        result[key] = value === 'none' ? [] : value.split(' ');
      } else result[key] = value;
    }
    if (typeof result.fen !== 'string') {
      throw new Error(`gamestate block missing fen: ${lines.slice(0, 2).join(' | ')}`);
    }
    return result;
  }

  _parseValidateResponse(line) {
    const parts = line.split(' ');
    return { valid: parts[1] === 'true', reason: parts.length > 2 ? parts[2] : null };
  }

  _parseLegalMovesResponse(line) {
    const content = line.slice('legalmoves '.length);
    if (content === 'none' || content.startsWith('none')) {
      return { moves: [], error: content.includes(' ') ? content.split(' ')[1] : null };
    }
    return { moves: content.split(' '), error: null };
  }

  parseInfo(line) {
    const info = {};
    const parts = line.split(' ');
    for (let i = 1; i < parts.length; i++) {
      switch (parts[i]) {
        case 'depth':    info.depth = parseInt(parts[++i], 10); break;
        case 'seldepth': info.seldepth = parseInt(parts[++i], 10); break;
        case 'nodes':    info.nodes = parseInt(parts[++i], 10); break;
        case 'nps':      info.nps = parseInt(parts[++i], 10); break;
        case 'time':     info.time = parseInt(parts[++i], 10); break;
        case 'score':
          if (parts[i + 1] === 'cp') { info.score = parseInt(parts[i + 2], 10); i += 2; }
          else if (parts[i + 1] === 'mate') { info.mate = parseInt(parts[i + 2], 10); i += 2; }
          break;
        case 'pv':       info.pv = parts.slice(i + 1); i = parts.length; break;
        case 'string':   info.string = parts.slice(i + 1).join(' '); i = parts.length; break;
        case 'hashfull': info.hashfull = parseInt(parts[++i], 10); break;
        default: break;
      }
    }
    return info;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // OUTBOUND TRANSPORT
  // ═══════════════════════════════════════════════════════════════════════
  /** Raw send. Callers below always run inside `_enqueue`. */
  send(command) {
    if (!this.connected || this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`[${this.label}] not connected to engine`);
    }
    this.ws.send(command);
  }

  /**
   * Run `task` after every previously queued task. Tasks run even if an
   * earlier one rejected — a failed `makemove` must not wedge the socket.
   */
  _enqueue(task) {
    const run = this._chain.then(task, task);
    this._chain = run.then(() => {}, () => {});
    return run;
  }

  /** Single-slot request. Must only be called from inside `_enqueue`. */
  _request(slot, command, timeout) {
    return new Promise((resolve, reject) => {
      if (this[slot] !== null) {
        // Unreachable given serialization. Kept as a loud invariant: if it
        // ever fires, something is bypassing `_enqueue`.
        reject(new Error(`[${this.label}] INVARIANT: ${slot} busy when sending "${command}"`));
        return;
      }
      const timeoutId = setTimeout(() => {
        this[slot] = null;
        reject(new Error(`[${this.label}] command timeout after ${timeout}ms: ${command}`));
      }, timeout);
      this[slot] = {
        resolve: (result) => { clearTimeout(timeoutId); resolve(result); },
        reject: (err) => { clearTimeout(timeoutId); reject(err); },
      };
      try {
        this.send(command);
      } catch (err) {
        clearTimeout(timeoutId);
        this[slot] = null;
        reject(err);
      }
    });
  }

  async sendAndWait(command, timeout = COMMAND_TIMEOUT_MS) {
    return this._enqueue(() => this._request('pendingSimpleResponse', command, timeout));
  }

  async sendMultiLineAndWait(command, timeout = COMMAND_TIMEOUT_MS) {
    return this._enqueue(() => this._request('pendingMultiLineResponse', command, timeout));
  }

  async sendSearchAndWait(command, timeout = SEARCH_TIMEOUT_MS) {
    return this._enqueue(() => this._request('pendingSearchResponse', command, timeout));
  }

  /** Fire-and-forget, but still ordered behind anything already queued. */
  async sendQueued(command) {
    return this._enqueue(() => { this.send(command); });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STANDARD UCI COMMANDS
  // ═══════════════════════════════════════════════════════════════════════
  /**
   * Handshake. ONE queued task, so `uci` + `isready` are indivisible, and
   * `handshakeComplete` (hence `isConnected()`) flips only at the end.
   */
  async initialize() {
    await this._enqueue(async () => {
      await this._request('pendingSimpleResponse', 'uci', COMMAND_TIMEOUT_MS);
      await this._request('pendingSimpleResponse', 'isready', COMMAND_TIMEOUT_MS);
      this.handshakeComplete = true;
    });
    this._notifyConnectionChange(true);
  }

  /** `ucinewgame` + `isready` as one indivisible task. */
  async newGame() {
    return this._enqueue(async () => {
      this.send('ucinewgame');
      await this._request('pendingSimpleResponse', 'isready', COMMAND_TIMEOUT_MS);
    });
  }

  async setPosition(fen = null, moves = []) {
    let cmd = fen ? `position fen ${fen}` : 'position startpos';
    if (moves.length > 0) cmd += ' moves ' + moves.join(' ');
    return this.sendQueued(cmd);
  }

  async go(options = {}) {
    let cmd = 'go';
    if (options.infinite) cmd += ' infinite';
    if (options.depth) cmd += ` depth ${options.depth}`;
    if (options.nodes) cmd += ` nodes ${options.nodes}`;
    if (options.movetime) cmd += ` movetime ${options.movetime}`;
    if (options.wtime) cmd += ` wtime ${options.wtime}`;
    if (options.btime) cmd += ` btime ${options.btime}`;
    if (options.winc) cmd += ` winc ${options.winc}`;
    if (options.binc) cmd += ` binc ${options.binc}`;
    if (options.movestogo) cmd += ` movestogo ${options.movestogo}`;
    return this.sendSearchAndWait(cmd);
  }

  /**
   * `stop` deliberately BYPASSES the queue: it exists to interrupt the task
   * currently holding the wire, so queueing it behind that task is useless.
   */
  stop() {
    if (!this.connected) return;
    try { this.send('stop'); }
    catch (e) { console.warn(`[${this.label}] failed to send stop:`, e); }
  }

  setOption(name, value) { return this.sendQueued(`setoption name ${name} value ${value}`); }

  /** @param {number} mask Bitmask from the engine's LOG_CATEGORY (0 = silent). */
  setLogMask(mask) { return this.sendQueued(`setlog ${mask}`); }

  /** @returns {Promise<{name,label,description}[]>} advertised config profiles. */
  getProfiles() { return Promise.resolve(this.availableProfiles); }

  /** @returns {Map<string,object>} advertised UCI options. */
  getOptions() { return this.availableOptions; }

  // ═══════════════════════════════════════════════════════════════════════
  // EXTENDED UCI COMMANDS FOR INTERACTIVE PLAY
  // ═══════════════════════════════════════════════════════════════════════
  async validateMove(move) { return this.sendAndWait(`validate ${move}`); }

  async getLegalMoves(square = null) {
    return this.sendAndWait(square ? `legalmoves ${square}` : 'legalmoves');
  }

  async makeMove(move) { return this.sendMultiLineAndWait(`makemove ${move}`); }
  async undoMove() { return this.sendMultiLineAndWait('undomove'); }
  async getGameState() { return this.sendMultiLineAndWait('gamestate'); }
  async getEvaluation() { return this.sendAndWait('eval'); }
}

export default EngineClient;