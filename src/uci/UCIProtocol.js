/**
 * UCI Protocol Implementation for Chess Master
 * 
 * This file outlines the UCI protocol specifications and provides
 * a framework for implementing them incrementally.
 */

export class UCIEngine {
  constructor(board, botPlayer) {
    this.board = board;
    this.botPlayer = botPlayer;
    this.isInitialized = false;
    this.options = new Map();
    this.searching = false;
    this.pondering = false;
    this.debug = false;
    
    this.initializeOptions();
  }

  /**
   * Initialize default UCI options
   */
  initializeOptions() {
    // Standard UCI options
    this.options.set('Hash', { type: 'spin', default: 16, min: 1, max: 128, value: 16 });
    this.options.set('Ponder', { type: 'check', default: false, value: false });
    this.options.set('OwnBook', { type: 'check', default: true, value: true });
    this.options.set('MultiPV', { type: 'spin', default: 1, min: 1, max: 500, value: 1 });
    
    // Custom options
    this.options.set('Difficulty', {
      type: 'combo',
      default: 'Casual',
      options: ['Rookie', 'Casual', 'Strategic', 'Master'],
      value: 'Casual'
    });
    
    // Additional UCI options to implement
    this.options.set('UCI_AnalyseMode', { type: 'check', default: false, value: false });
    this.options.set('UCI_ShowCurrLine', { type: 'check', default: false, value: false });
    this.options.set('UCI_ShowRefutations', { type: 'check', default: false, value: false });
    this.options.set('UCI_LimitStrength', { type: 'check', default: false, value: false });
    this.options.set('UCI_Elo', { type: 'spin', default: 1500, min: 1000, max: 2800, value: 1500 });
  }

  /**
   * Process UCI commands
   * @param {string} command - The UCI command to process
   * @returns {string} - Response to the command
   */
  processCommand(command) {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];

    switch (cmd) {
      case 'uci':
        return this.handleUCI();
      
      case 'isready':
        return this.handleIsReady();
      
      case 'ucinewgame':
        return this.handleNewGame();
      
      case 'position':
        return this.handlePosition(parts.slice(1));
      
      case 'go':
        return this.handleGo(parts.slice(1));
      
      case 'stop':
        return this.handleStop();
      
      case 'quit':
        return this.handleQuit();
      
      case 'setoption':
        return this.handleSetOption(parts.slice(1));
      
      case 'debug':
        return this.handleDebug(parts[1]);
      
      case 'register':
        return this.handleRegister(parts.slice(1));
      
      case 'ponderhit':
        return this.handlePonderHit();
      
      default:
        // Unknown command - ignore
        return '';
    }
  }

  /**
   * Handle 'uci' command
   * @returns {string} - UCI initialization response
   */
  handleUCI() {
    let response = 'id name Chess Master 1.0\n';
    response += 'id author Salem Ait Ami\n';
    
    // Send available options
    for (const [name, option] of this.options) {
      response += this.formatOption(name, option) + '\n';
    }
    
    response += 'uciok';
    this.isInitialized = true;
    return response;
  }

  /**
   * Handle 'isready' command
   * @returns {string} - Ready confirmation
   */
  handleIsReady() {
    // TODO: Ensure all initialization is complete
    return 'readyok';
  }

  /**
   * Handle 'ucinewgame' command
   * @returns {string} - Empty response
   */
  handleNewGame() {
    // TODO: Reset internal state for new game
    this.board.constructor();
    return '';
  }

  /**
   * Handle 'position' command
   * @param {Array} args - Position arguments
   * @returns {string} - Empty response
   */
  handlePosition(args) {
    // TODO: Implement FEN parsing and move application
    // position [fen <fenstring> | startpos] moves <move1> .... <movei>
    
    if (args[0] === 'startpos') {
      // Set up starting position
      this.board = new (this.board.constructor)();
      
      // Apply moves if provided
      const movesIndex = args.indexOf('moves');
      if (movesIndex !== -1) {
        const moves = args.slice(movesIndex + 1);
        // TODO: Apply each move
      }
    } else if (args[0] === 'fen') {
      // TODO: Parse FEN and set up position
    }
    
    return '';
  }

  /**
   * Handle 'go' command
   * @param {Array} args - Search arguments
   * @returns {string} - Empty response (bestmove sent asynchronously)
   */
  handleGo(args) {
    // TODO: Implement search with given parameters
    // Parse time controls, depth, nodes, etc.
    
    const params = this.parseGoParams(args);
    
    // Start search asynchronously
    this.startSearch(params);
    
    return '';
  }

  /**
   * Handle 'stop' command
   * @returns {string} - Empty response (bestmove sent when search stops)
   */
  handleStop() {
    // TODO: Stop current search
    this.searching = false;
    return '';
  }

  /**
   * Handle 'quit' command
   * @returns {string} - Empty response
   */
  handleQuit() {
    // TODO: Clean up and exit
    return '';
  }

  /**
   * Handle 'setoption' command
   * @param {Array} args - Option arguments
   * @returns {string} - Empty response
   */
  handleSetOption(args) {
    // TODO: Parse and set option
    // setoption name <id> [value <x>]
    
    const nameIndex = args.indexOf('name');
    const valueIndex = args.indexOf('value');
    
    if (nameIndex === -1) return '';
    
    const name = args.slice(nameIndex + 1, valueIndex === -1 ? undefined : valueIndex).join(' ');
    const value = valueIndex === -1 ? null : args.slice(valueIndex + 1).join(' ');
    
    if (this.options.has(name)) {
      // TODO: Validate and set option value
    }
    
    return '';
  }

  /**
   * Handle 'debug' command
   * @param {string} mode - 'on' or 'off'
   * @returns {string} - Empty response
   */
  handleDebug(mode) {
    this.debug = mode === 'on';
    return '';
  }

  /**
   * Handle 'register' command
   * @param {Array} args - Registration arguments
   * @returns {string} - Empty response
   */
  handleRegister(args) {
    // Not needed for open source engine
    return '';
  }

  /**
   * Handle 'ponderhit' command
   * @returns {string} - Empty response
   */
  handlePonderHit() {
    // TODO: Switch from pondering to normal search
    this.pondering = false;
    return '';
  }

  /**
   * Format option for UCI output
   * @param {string} name - Option name
   * @param {Object} option - Option details
   * @returns {string} - Formatted option string
   */
  formatOption(name, option) {
    let result = `option name ${name} type ${option.type}`;
    
    if (option.default !== undefined) {
      result += ` default ${option.default}`;
    }
    
    if (option.type === 'spin') {
      result += ` min ${option.min} max ${option.max}`;
    } else if (option.type === 'combo') {
      for (const opt of option.options) {
        result += ` var ${opt}`;
      }
    }
    
    return result;
  }

  /**
   * Parse go command parameters
   * @param {Array} args - Go command arguments
   * @returns {Object} - Parsed parameters
   */
  parseGoParams(args) {
    const params = {
      searchmoves: [],
      ponder: false,
      wtime: null,
      btime: null,
      win: null,
      binc: null,
      movestogo: null,
      depth: null,
      nodes: null,
      mate: null,
      movetime: null,
      infinite: false
    };

    // TODO: Parse each parameter type
    
    return params;
  }

  /**
   * Start search with given parameters
   * @param {Object} params - Search parameters
   */
  async startSearch(params) {
    this.searching = true;
    
    // TODO: Implement actual search
    // This should use the bot player's search capabilities
    
    // Send info during search
    this.sendInfo({
      depth: 5,
      score: { cp: 20 },
      time: 1000,
      nodes: 50000,
      pv: ['e2e4', 'e7e5']
    });
    
    // Send best move when done
    this.sendBestMove('e2e4', 'e7e5');
  }

  /**
   * Send info to GUI
   * @param {Object} info - Information to send
   */
  sendInfo(info) {
    let message = 'info';
    
    if (info.depth !== undefined) message += ` depth ${info.depth}`;
    if (info.seldepth !== undefined) message += ` seldepth ${info.seldepth}`;
    if (info.time !== undefined) message += ` time ${info.time}`;
    if (info.nodes !== undefined) message += ` nodes ${info.nodes}`;
    if (info.pv) message += ` pv ${info.pv.join(' ')}`;
    if (info.score) {
      if (info.score.cp !== undefined) message += ` score cp ${info.score.cp}`;
      if (info.score.mate !== undefined) message += ` score mate ${info.score.mate}`;
    }
    
    // TODO: Send message to GUI
    console.log(message);
  }

  /**
   * Send best move to GUI
   * @param {string} move - Best move in UCI format
   * @param {string} ponder - Ponder move (optional)
   */
  sendBestMove(move, ponder) {
    let message = `bestmove ${move}`;
    if (ponder) message += ` ponder ${ponder}`;
    
    // TODO: Send message to GUI
    console.log(message);
    
    this.searching = false;
  }
}

// TODO: Implement additional UCI features as needed:
// 1. FEN parsing and generation
// 2. Move notation conversion (algebraic to UCI format)
// 3. Time management
// 4. Multi-PV support
// 5. Chess960 support
// 6. Tablebase support
// 7. Opening book integration with UCI protocol
// 8. Proper threading/worker support for non-blocking search