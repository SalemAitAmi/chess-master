# Chess Master

A chess engine built with React featuring intelligent bot opponents with detailed decision analysis.

**Live Demo**: [https://salemaitami.github.io/chess-master/](https://salemaitami.github.io/chess-master/)

[![chess-master-img.png](https://i.postimg.cc/3rZvRmdV/chess-master-img.png)](https://postimg.cc/9zrMg4PY)

## Summary

Key features include:

- **2-player local play** - Play against a friend on the same device
- **vs Computer mode** - Challenge AI opponents of varying skill levels
- **Colosseum mode** - Watch bots battle each other with detailed analysis
- Full chess functionality including castling and en passant
- **4 difficulty levels** with intelligent minimax-based AI:
  - Rookie (2-4 ply depth)
  - Casual (4-6 ply depth)
  - Strategic (6-8 ply depth)
  - Master (8-10 ply depth)
- **Opening book integration** with move ordering priority
- **Detailed decision reports** for bot analysis
- CSS styling using Tailwind CSS

## Installation and Usage

Clone the repository and install dependencies:
```bash
git clone https://github.com/salemAitAmi/chess-master.git
cd chess-master
npm install
npm start
```

## Game Modes

### Local Play
Two players can play against each other on the same device. The board automatically rotates to show the current player's perspective.

### vs Computer
Play against an AI opponent. Choose your color (white or black) and select from four difficulty levels:

| Difficulty | Ply Depth | Max Time | Features |
|------------|-----------|----------|----------|
| Rookie     | 2-4       | 15s      | Basic center control, development |
| Casual     | 4-6       | 15s      | + Pawn structure, opening book |
| Strategic  | 6-8       | 15s      | + King safety, killer moves, history heuristic |
| Master     | 8-10      | 15s      | + Null move pruning, all optimizations |

### Colosseum Mode (Bot vs Bot)
Watch two AI opponents battle each other! Features:
- Select difficulty for each bot (white and black)
- Choose number of rounds (1, 3, 5, 10, or 20)
- Colors swap between rounds for fair comparison
- Real-time match statistics
- Download all bot decisions for analysis

## Bot Decision Analysis

The bot generates detailed decision reports for every move, including:
- Opening book attempts and results
- Search statistics (depth, time, positions evaluated)
- Move evaluations with heuristic breakdowns
- Imperfection applications (blunders/mistakes at lower difficulties)

### Downloading Reports
- **Download Last Decision (TXT/JSON)** - Get the most recent bot decision
- **Download All Decisions (JSON)** - Get all decisions from the current game, sorted from first to last

### Heuristics Analyzed
- **Material** - Piece value balance
- **Center Control** - Bonus for pieces controlling central squares
- **Development** - Encourages piece development in opening
- **Pawn Structure** - Evaluates doubled, isolated, and passed pawns
- **King Safety** - Pawn shield and open file penalties
- **Pawn Push Bonus** - Encourages double pawn pushes when appropriate

## Scripts

### Colosseum CLI
Run bot matches programmatically:
```bash
node scripts/colosseum-runner.mjs --white=casual --black=master --rounds=5
```

### Decision Analyzer (Python)
Analyze bot decision JSON files to identify heuristic issues:
```bash
python scripts/analyze_decisions.py game_decisions.json --output ./analysis --visualize
```

The analyzer identifies:
- Over/under-contributing heuristics
- Search performance patterns
- Opening book usage
- Move quality distribution
- Temporal patterns across game phases

## Technical Details

### Search Algorithm
- Iterative deepening minimax with alpha-beta pruning
- Quiescence search for tactical accuracy
- Move ordering optimizations:
  - Opening book moves (highest priority)
  - MVV-LVA for captures
  - Killer move heuristic
  - History heuristic
  - Promotion bonus
  - Pawn double push bonus

### Opening Book
Uses Polyglot format opening book (baron30.bin) with probabilistic move selection. Opening book moves are integrated into the search process through move ordering rather than bypassing evaluation.

### Board Representation
- Bitboard-based representation for efficient move generation
- Zobrist hashing for position identification
- Full FEN support for position export

## API Reference

### BotPlayer Exports
```javascript
import { 
  BotPlayer,
  createBotPlayer,
  DIFFICULTY,
  downloadReport,
  downloadAllReports,
  getLatestReport,
  getReportHistory,
  clearReportHistory
} from './players/BotPlayer';

// Create a bot
const bot = createBotPlayer('white', board, 'master');

// Download reports
downloadReport('json');        // Last decision as JSON
downloadAllReports('json');    // All decisions as JSON (sorted first to last)
```

### Utility Functions
```javascript
import { boardToFen } from './utils/chessUtils';

// Convert board to FEN string
const fen = boardToFen(board);
```

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT License
