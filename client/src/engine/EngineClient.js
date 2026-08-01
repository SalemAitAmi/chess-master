/**
 * UCI Engine Client for communicating with the backend engine server
 * Extended with local play support commands
 */

export class EngineClient {
  constructor(serverUrl = 'ws://localhost:8080') {
    this.serverUrl = serverUrl;
    this.ws = null;
    this.connected = false;
    this.ready = false;
    
    // Response handling
    this.pendingSimpleResponse = null;
    this.pendingSearchResponse = null;
    this.pendingMultiLineResponse = null;
    
    // Callbacks
    this.onInfo = null;
    this.onBestMove = null;
    this.onConnectionChange = null;
    this.onError = null;
    this.onGameState = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          this.connected = true;
          console.log('Connected to engine server');
          this._notifyConnectionChange(true);
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          if (this.onError) {
            this.onError(error);
          }
          if (!this.connected) {
            reject(new Error('Failed to connect to engine server'));
          }
        };

        this.ws.onclose = (event) => {
          const wasConnected = this.connected;
          this.connected = false;
          this.ready = false;
          console.log('Disconnected from engine server', event.code, event.reason);

          this._rejectAllPending(new Error('Connection closed'));

          if (wasConnected) {
            this._notifyConnectionChange(false);
          }
        };

        setTimeout(() => {
          if (!this.connected) {
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, 5000);

      } catch (err) {
        reject(err);
      }
    });
  }

  _notifyConnectionChange(isConnected) {
    if (this.onConnectionChange) {
      this.onConnectionChange(isConnected);
    }
  }

  _rejectAllPending(error) {
    if (this.pendingSimpleResponse) {
      this.pendingSimpleResponse.reject(error);
      this.pendingSimpleResponse = null;
    }
    if (this.pendingSearchResponse) {
      this.pendingSearchResponse.reject(error);
      this.pendingSearchResponse = null;
    }
    if (this.pendingMultiLineResponse) {
      this.pendingMultiLineResponse.reject(error);
      this.pendingMultiLineResponse = null;
    }
  }

  handleMessage(data) {
    const lines = data.split('\n');
    
    // Check if this is a multi-line response (gamestate, etc.)
    if (this.pendingMultiLineResponse) {
      const pending = this.pendingMultiLineResponse;
      this.pendingMultiLineResponse = null;
      try { pending.resolve(this._parseMultiLineResponse(lines)); }
      catch (err) { pending.reject(err); }
      return;
    }

    for (const line of lines) {
      if (!line.trim()) continue;

      console.log('Engine:', line);

      if (line === 'uciok') {
        this.ready = true;
        this._notifyConnectionChange(true);
        if (this.pendingSimpleResponse) {
          this.pendingSimpleResponse.resolve();
          this.pendingSimpleResponse = null;
        }
      } else if (line === 'readyok') {
        if (this.pendingSimpleResponse) {
          this.pendingSimpleResponse.resolve();
          this.pendingSimpleResponse = null;
        }
      } else if (line.startsWith('bestmove')) {
        const parts = line.split(' ');
        const move = parts[1];
        const ponder = parts[3] || null;

        if (this.onBestMove) {
          this.onBestMove(move, ponder);
        }
        if (this.pendingSearchResponse) {
          this.pendingSearchResponse.resolve({ move, ponder });
          this.pendingSearchResponse = null;
        }
      } else if (line.startsWith('info')) {
        if (this.onInfo) {
          this.onInfo(this.parseInfo(line));
        }
      } else if (line.startsWith('valid ')) {
        // Response to validate command
        if (this.pendingSimpleResponse) {
          this.pendingSimpleResponse.resolve(this._parseValidateResponse(line));
          this.pendingSimpleResponse = null;
        }
      } else if (line.startsWith('legalmoves ')) {
        // Response to legalmoves command
        if (this.pendingSimpleResponse) {
          this.pendingSimpleResponse.resolve(this._parseLegalMovesResponse(line));
          this.pendingSimpleResponse = null;
        }
      } else if (line.startsWith('eval ')) {
        if (this.pendingSimpleResponse) {
          this.pendingSimpleResponse.resolve({ eval: parseInt(line.split(' ')[1]) });
          this.pendingSimpleResponse = null;
        }
      } else if (line.startsWith('error ')) {
        if (this.pendingSimpleResponse) {
          this.pendingSimpleResponse.reject(new Error(line.slice(6)));
          this.pendingSimpleResponse = null;
        }
      }
    }
  }

  _parseMultiLineResponse(lines) {
    const first = lines.find(l => l.trim());
    if (first && (first.startsWith('error ') || first.startsWith('valid false'))) {
      throw new Error(first);                 // rejected by the wrapper below
    }
    const result = {};
    for (const line of lines) {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) continue;
      const key = line.slice(0, spaceIdx);
      const value = line.slice(spaceIdx + 1);
      
      // Parse specific types
      if (['incheck', 'canundo', 'blunder'].includes(key)) {
        result[key] = value === 'true';
      } else if (['fullmove', 'halfmove', 'legalmovecount', 'eval', 
                  'material_white', 'material_black', 'material_diff', 'movecount'].includes(key)) {
        result[key] = parseInt(value) || 0;
      } else if (key === 'captured_white' || key === 'captured_black') {
        result[key] = value === 'none' ? [] : value.split('');
      } else if (key === 'history') {
        result[key] = value === 'none' ? [] : value.split(' ');
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  _parseValidateResponse(line) {
    const parts = line.split(' ');
    return {
      valid: parts[1] === 'true',
      reason: parts[2] || null
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
          info.depth = parseInt(parts[++i]);
          break;
        case 'seldepth':
          info.seldepth = parseInt(parts[++i]);
          break;
        case 'nodes':
          info.nodes = parseInt(parts[++i]);
          break;
        case 'nps':
          info.nps = parseInt(parts[++i]);
          break;
        case 'time':
          info.time = parseInt(parts[++i]);
          break;
        case 'score':
          if (parts[i + 1] === 'cp') {
            info.score = parseInt(parts[i + 2]);
            i += 2;
          } else if (parts[i + 1] === 'mate') {
            info.mate = parseInt(parts[i + 2]);
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
          info.hashfull = parseInt(parts[++i]);
          break;
      }
    }

    return info;
  }

  send(command) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to engine');
    }
    console.log('Sending:', command);
    this.ws.send(command);
  }

  async sendAndWait(command, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingSimpleResponse = null;
        reject(new Error(`Command timeout: ${command}`));
      }, timeout);

      this.pendingSimpleResponse = {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeoutId);
          reject(err);
        }
      };

      try {
        this.send(command);
      } catch (err) {
        clearTimeout(timeoutId);
        this.pendingSimpleResponse = null;
        reject(err);
      }
    });
  }

  async sendMultiLineAndWait(command, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingMultiLineResponse = null;
        reject(new Error(`Command timeout: ${command}`));
      }, timeout);

      this.pendingMultiLineResponse = {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeoutId);
          reject(err);
        }
      };

      try {
        this.send(command);
      } catch (err) {
        clearTimeout(timeoutId);
        this.pendingMultiLineResponse = null;
        reject(err);
      }
    });
  }

  async sendSearchAndWait(command) {
    return new Promise((resolve, reject) => {
      this.pendingSearchResponse = { resolve, reject };

      try {
        this.send(command);
      } catch (err) {
        this.pendingSearchResponse = null;
        reject(err);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STANDARD UCI COMMANDS
  // ═══════════════════════════════════════════════════════════════════════════

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
    if (moves.length > 0) {
      cmd += ' moves ' + moves.join(' ');
    }
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
    if (this.connected) {
      try {
        this.send('stop');
      } catch (e) {
        console.warn('Failed to send stop:', e);
      }
    }
  }

  setOption(name, value) {
    this.send(`setoption name ${name} value ${value}`);
  }

  /** @param {number} mask Bitmask from the engine's LOG_CATEGORY (0 = silent). */
  setLogMask(mask) { this.send(`setlog ${mask}`); }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTENDED UCI COMMANDS FOR LOCAL PLAY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate a move without applying it
   * @param {string} move - Move in UCI format (e.g., "e2e4", "e7e8q")
   * @returns {Promise<{valid: boolean, reason: string|null}>}
   */
  async validateMove(move) {
    return this.sendAndWait(`validate ${move}`);
  }

  /**
   * Get all legal moves, optionally for a specific square
   * @param {string|null} square - Optional source square (e.g., "e2")
   * @returns {Promise<{moves: string[], error: string|null}>}
   */
  async getLegalMoves(square = null) {
    const cmd = square ? `legalmoves ${square}` : 'legalmoves';
    return this.sendAndWait(cmd);
  }

  /**
   * Apply a move and get updated game state
   * @param {string} move - Move in UCI format
   * @returns {Promise<GameState>} Full game state after move
   */
  async makeMove(move) {
    return this.sendMultiLineAndWait(`makemove ${move}`);
  }

  /**
   * Undo the last move
   * @returns {Promise<GameState>} Full game state after undo
   */
  async undoMove() {
    return this.sendMultiLineAndWait('undomove');
  }

  /**
   * Get current game state
   * @returns {Promise<GameState>}
   */
  async getGameState() {
    return this.sendMultiLineAndWait('gamestate');
  }

  /**
   * Get static evaluation of current position
   * @returns {Promise<{eval: number}>}
   */
  async getEvaluation() {
    return this.sendAndWait('eval');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  disconnect() {
    if (this.ws) {
      if (this.connected) {
        try {
          this.send('quit');
        } catch (e) {
          // Ignore send errors during disconnect
        }
      }
      this.ws.close();
      this.ws = null;
      this.connected = false;
      this.ready = false;
    }
  }

  isConnected() {
    return this.connected && this.ready && this.ws?.readyState === WebSocket.OPEN;
  }

  isSearching() {
    return this.pendingSearchResponse !== null;
  }
}

export default EngineClient;