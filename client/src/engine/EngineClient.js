/**
 * UCI Engine Client for communicating with the backend engine server
 */

export const LOG_CATEGORY = {
  NONE:       0,
  SEARCH:     1 << 0,
  EVAL:       1 << 1,
  MOVE_ORDER: 1 << 2,
  TT:         1 << 3,
  UCI:        1 << 4,
  BOOK:       1 << 5,
  HEURISTICS: 1 << 6,
  MOVES:      1 << 7,
  PV:         1 << 8,
  TIME:       1 << 9,
  ALL:        0x3FF
};

export class EngineClient {
  constructor(serverUrl = 'ws://localhost:8080') {
    this.serverUrl = serverUrl;
    this.ws = null;
    this.connected = false;
    this.ready = false;
    
    // Separate handling for different response types
    this.pendingSimpleResponse = null;  // For uci, isready
    this.pendingSearchResponse = null;  // For go command (no timeout)
    
    // Callbacks
    this.onInfo = null;
    this.onBestMove = null;
    this.onConnectionChange = null;
    this.onError = null;
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

          // Reject any pending responses
          if (this.pendingSimpleResponse) {
            this.pendingSimpleResponse.reject(new Error('Connection closed'));
            this.pendingSimpleResponse = null;
          }
          if (this.pendingSearchResponse) {
            this.pendingSearchResponse.reject(new Error('Connection closed'));
            this.pendingSearchResponse = null;
          }

          if (wasConnected) {
            this._notifyConnectionChange(false);
          }
        };

        // Connection timeout
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

  handleMessage(data) {
    const lines = data.split('\n');

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
        // Resolve the search promise (no timeout for searches)
        if (this.pendingSearchResponse) {
          this.pendingSearchResponse.resolve({ move, ponder });
          this.pendingSearchResponse = null;
        }
      } else if (line.startsWith('info')) {
        if (this.onInfo) {
          this.onInfo(this.parseInfo(line));
        }
      }
    }
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

  /**
   * Send command and wait for simple response (with timeout)
   */
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

  /**
   * Send search command and wait for bestmove (NO timeout - searches can take arbitrarily long)
   */
  async sendSearchAndWait(command) {
    return new Promise((resolve, reject) => {
      // No timeout for search commands
      this.pendingSearchResponse = {
        resolve,
        reject
      };

      try {
        this.send(command);
      } catch (err) {
        this.pendingSearchResponse = null;
        reject(err);
      }
    });
  }

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

  /**
   * Start search - returns promise that resolves when bestmove is received
   * No timeout since searches can take arbitrarily long
   */
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

    // Use search-specific method without timeout
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

  setLogMask(mask) {
    this.send(`setlog ${mask}`);
  }

  clearLogs() {
    this.send('clearlogs');
  }

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

  /**
   * Check if a search is currently in progress
   */
  isSearching() {
    return this.pendingSearchResponse !== null;
  }
}

export default EngineClient;