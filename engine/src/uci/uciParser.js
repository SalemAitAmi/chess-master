/**
 * UCI command parser
 */

export function parseUCICommand(line) {
  const parts = line.trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  
  switch (command) {
    case 'uci':
      return { type: 'uci' };
      
    case 'debug':
      return { type: 'debug', on: args[0] === 'on' };
      
    case 'isready':
      return { type: 'isready' };
      
    case 'setoption':
      return parseSetOption(args);
      
    case 'ucinewgame':
      return { type: 'ucinewgame' };
      
    case 'position':
      return parsePosition(args);
      
    case 'go':
      return parseGo(args);
      
    case 'stop':
      return { type: 'stop' };
      
    case 'quit':
      return { type: 'quit' };
      
    // Custom extensions
    case 'setlog':
      return { type: 'setlog', mask: parseInt(args[0]) || 0 };
      
    case 'clearlogs':
      return { type: 'clearlogs' };

    case 'showstage':
      return { type: 'showstage' };

    case 'showdecision':
      return { type: 'showdecision' };

    case 'logstage':
      return { 
        type: 'logstage', 
        stage: args[0], 
        enabled: args[1] !== 'off' 
      };
      
    default:
      return { type: 'unknown', command, args };
  }
}

function parseSetOption(args) {
  let name = '';
  let value = '';
  let inName = false;
  let inValue = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === 'name') {
      inName = true;
      inValue = false;
    } else if (args[i] === 'value') {
      inName = false;
      inValue = true;
    } else if (inName) {
      name += (name ? ' ' : '') + args[i];
    } else if (inValue) {
      value += (value ? ' ' : '') + args[i];
    }
  }
  
  return { type: 'setoption', name, value };
}

function parsePosition(args) {
  const result = { type: 'position', fen: null, moves: [] };
  
  let i = 0;
  if (args[i] === 'startpos') {
    result.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    i++;
  } else if (args[i] === 'fen') {
    i++;
    const fenParts = [];
    while (i < args.length && args[i] !== 'moves') {
      fenParts.push(args[i]);
      i++;
    }
    result.fen = fenParts.join(' ');
  }
  
  if (args[i] === 'moves') {
    i++;
    while (i < args.length) {
      result.moves.push(args[i]);
      i++;
    }
  }
  
  return result;
}

function parseGo(args) {
  const result = { type: 'go' };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case 'infinite':
        result.infinite = true;
        break;
      case 'depth':
        result.depth = parseInt(args[++i]);
        break;
      case 'nodes':
        result.nodes = parseInt(args[++i]);
        break;
      case 'movetime':
        result.movetime = parseInt(args[++i]);
        break;
      case 'wtime':
        result.wtime = parseInt(args[++i]);
        break;
      case 'btime':
        result.btime = parseInt(args[++i]);
        break;
      case 'winc':
        result.winc = parseInt(args[++i]);
        break;
      case 'binc':
        result.binc = parseInt(args[++i]);
        break;
      case 'movestogo':
        result.movestogo = parseInt(args[++i]);
        break;
      case 'searchmoves':
        result.searchmoves = [];
        i++;
        while (i < args.length && !['infinite', 'depth', 'nodes', 'movetime', 'wtime', 'btime'].includes(args[i])) {
          result.searchmoves.push(args[i]);
          i++;
        }
        i--;
        break;
    }
  }
  
  return result;
}