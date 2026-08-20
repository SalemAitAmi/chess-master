/**
 * UCI Engine Client for communicating with the backend engine server.
 *
 * Response routing: a command that expects a reply installs exactly one
 * pending slot (simple / multi-line / search). Every slot is timeout-guarded,
 * including searches, so a lost `bestmove` surfaces as a rejected promise
 * instead of a hung UI.
 *
 * Layout: constants → class (fields grouped in constructor, methods grouped
 * by concern). No optional chaining.
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
  constructor(serverUrl = DEFAULT_SERVER_URL) {
    // ── Connection ──
    this.serverUrl = serverUrl;
    this.ws = null;
    this.connected = false;
    this.ready = false;

    // ── Pending response slots ──
    this.pendingSimpleResponse = null;
    this.pendingSearchResponse = null;
    this.pendingMultiLineResponse = null;

    // ── Callbacks ──
    this.onInfo = null;
    this.onBestMove = null;
    this.onConnectionChange = null;
    this.onError = null;
    this.onGameState = null;
  }

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
        console.log('Connected to engine server');
        this._notifyConnectionChange(true);
        settleResolve();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (this.onError) this.onError(error);
        if (!this.connected) settleReject(new Error('Failed to connect to engine server'));
      };

      this.ws.onclose = (event) => {
        const wasConnected = this.connected;
        this.connected = false;
        this.ready = false;
        console.log('Disconnected from engine server', event.code, event.reason);
        this._rejectAllPending(new Error('Connection closed'));
        if (wasConnected) this._notifyConnectionChange(false);
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
    if (this.connected) {
      try { this.send('quit'); } catch (e) { /* ignore during teardown */ }
    }
    this.ws.close();
    this.ws = null;
    this.connected = false;
    this.ready = false;
  }

  isConnected() {
    return this.connected && this.ready && this.ws !== null &&
           this.ws.readyState === WebSocket.OPEN;
  }

  isSearching() {
    return this.pendingSearchResponse !== null;
  }

  _notifyConnectionChange(isConnected) {
    if (this.onConnectionChange) this.onConnectionChange(isConnected);
  }

  _rejectAllPending(error) {
    if (this.pendingSimpleResponse) {
      const p = this.pendingSimpleResponse;
      this.pendingSimpleResponse = null;
      p.reject(error);
    }
    if (this.pendingSearchResponse) {
      const p = this.pendingSearchResponse;
      this.pendingSearchResponse = null;
      p.reject(error);
    }
    if (this.pendingMultiLineResponse) {
      const p = this.pendingMultiLineResponse;
      this.pendingMultiLineResponse = null;
      p.reject(error);
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
      pending.resolve(parsed);
      return;
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      console.log('Engine:', line);
      this._routeLine(line);
    }
  }

  _routeLine(line) {
    if (line === 'uciok') {
      this.ready = true;
      this._notifyConnectionChange(true);
      this._resolveSimple(undefined);
      return;
    }
    if (line === 'readyok') {
      this._resolveSimple(undefined);
      return;
    }
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
    if (line.startsWith('valid ')) {
      this._resolveSimple(this._parseValidateResponse(line));
      return;
    }
    if (line.startsWith('legalmoves ')) {
      this._resolveSimple(this._parseLegalMovesResponse(line));
      return;
    }
    if (line.startsWith('eval ')) {
      this._resolveSimple({ eval: parseInt(line.split(' ')[1], 10) });
      return;
    }
    if (line.startsWith('error ')) {
      this._rejectSimple(new Error(line.slice(6)));
      return;
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

      if (MULTILINE_KEYS_BOOL.includes(key)) {
        result[key] = value === 'true';
      } else if (MULTILINE_KEYS_INT.includes(key)) {
        result[key] = parseInt(value, 10) || 0;
      } else if (key === 'captured_white' || key === 'captured_black') {
        result[key] = value === 'none' ? [] : value.split('');
      } else if (key === 'history' || key === 'historyuci') {
        result[key] = value === 'none' ? [] : value.split(' ');
      } else {
        result[key] = value;
      }
    }
    if (typeof result.fen !== 'string') {
      throw new Error(`gamestate block missing fen: ${lines.slice(0, 2).join(' | ')}`);
    }
    return result;
  }

  _parseValidateResponse(line) {
    const parts = line.split(' ');
    return {
      valid: parts[1] === 'true',
      reason: parts.length > 2 ? parts[2] : null
    };
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
        case 'depth':
          info.depth = parseInt(parts[++i], 10);
          break;
        case 'seldepth':
          info.seldepth = parseInt(parts[++i], 10);
          break;
        case 'nodes':
          info.nodes = parseInt(parts[++i], 10);
          break;
        case 'nps':
          info.nps = parseInt(parts[++i], 10);
          break;
        case 'time':
          info.time = parseInt(parts[++i], 10);
          break;
        case 'score':
          if (parts[i + 1] === 'cp') {
            info.score = parseInt(parts[i + 2], 10);
            i += 2;
          } else if (parts[i + 1] === 'mate') {
            info.mate = parseInt(parts[i + 2], 10);
            i += 2;
          }
          break;
        case 'pv':
          info.pv = parts.slice(i + 1);
          i = parts.length;
          break;
        case 'string':
          info.string = parts.slice(i + 1).join(' ');
          i = parts.length;
          break;
        case 'hashfull':
          info.hashfull = parseInt(parts[++i], 10);
          break;
        default:
          break;
      }
    }
    return info;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // OUTBOUND TRANSPORT
  // ═══════════════════════════════════════════════════════════════════════

  send(command) {
    if (!this.connected || this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to engine');
    }
    console.log('Sending:', command);
    this.ws.send(command);
  }

  /** Generic single-slot request. `slot` names the pending field to occupy. */
  _request(slot, command, timeout) {
    return new Promise((resolve, reject) => {
      if (this[slot] !== null) {
        reject(new Error(`Command overlap: ${slot} busy when sending "${command}"`));
        return;
      }
      const timeoutId = setTimeout(() => {
        this[slot] = null;
        reject(new Error(`Command timeout after ${timeout}ms: ${command}`));
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
    return this._request('pendingSimpleResponse', command, timeout);
  }

  async sendMultiLineAndWait(command, timeout = COMMAND_TIMEOUT_MS) {
    return this._request('pendingMultiLineResponse', command, timeout);
  }

  async sendSearchAndWait(command, timeout = SEARCH_TIMEOUT_MS) {
    return this._request('pendingSearchResponse', command, timeout);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STANDARD UCI COMMANDS
  // ═══════════════════════════════════════════════════════════════════════

  async initialize() {
    await this.sendAndWait('uci');
    await this.sendAndWait('isready');
  }

  async newGame() {
    this.send('ucinewgame');
    await this.sendAndWait('isready');
  }

  async setPosition(fen = null, moves = []) {
    let cmd = fen ? `position fen ${fen}` : 'position startpos';
    if (moves.length > 0) cmd += ' moves ' + moves.join(' ');
    this.send(cmd);
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

  stop() {
    if (!this.connected) return;
    try { this.send('stop'); }
    catch (e) { console.warn('Failed to send stop:', e); }
  }

  setOption(name, value) {
    this.send(`setoption name ${name} value ${value}`);
  }

  /** @param {number} mask Bitmask from the engine's LOG_CATEGORY (0 = silent). */
  setLogMask(mask) { this.send(`setlog ${mask}`); }

  // ═══════════════════════════════════════════════════════════════════════
  // EXTENDED UCI COMMANDS FOR LOCAL PLAY
  // ═══════════════════════════════════════════════════════════════════════

  /** @returns {Promise<{valid: boolean, reason: string|null}>} */
  async validateMove(move) {
    return this.sendAndWait(`validate ${move}`);
  }

  /** @returns {Promise<{moves: string[], error: string|null}>} */
  async getLegalMoves(square = null) {
    const cmd = square ? `legalmoves ${square}` : 'legalmoves';
    return this.sendAndWait(cmd);
  }

  /** @returns {Promise<GameState>} Full game state after move */
  async makeMove(move) {
    return this.sendMultiLineAndWait(`makemove ${move}`);
  }

  /** @returns {Promise<GameState>} Full game state after undo */
  async undoMove() {
    return this.sendMultiLineAndWait('undomove');
  }

  /** @returns {Promise<GameState>} */
  async getGameState() {
    return this.sendMultiLineAndWait('gamestate');
  }

  /** @returns {Promise<{eval: number}>} */
  async getEvaluation() {
    return this.sendAndWait('eval');
  }
}

export default EngineClient;