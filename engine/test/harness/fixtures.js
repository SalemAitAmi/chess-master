import { Board } from '../../src/core/board.js';
import { SearchEngine } from '../../src/search/search.js';
import { DecisionCollector } from './DecisionCollector.js';
import { DEFAULT_CONFIG } from '../../src/core/constants.js';

/**
 * Run a search on a position and return both the result and the
 * decision trace. One-shot, no retained state.
 */
export function searchPosition(fen, { depth = 4, config = {}, bookHints = null } = {}) {
  const board = Board.fromFen(fen);
  const engine = new SearchEngine({ ...DEFAULT_CONFIG, ...config });
  const collector = new DecisionCollector();

  const result = engine.search(board, depth, { bookHints, collector });

  return { result, collector, board };
}

/**
 * Named positions for regression tests.
 */
export const POSITIONS = {
  startpos: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',

  // Classic tactics — engine MUST find these at low depth
  mateInOne:    '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',           // Re8#
  
  // Knight fork: Nxc7+ hits K(e8) + R(a8). Previous fixture had a knight
  // on c6 that could trap the white knight after Nxc7+ Kd7 Nxa8 — that's
  // why the gap was only 80cp. This version has a bishop on e7 instead.
  forkKnight: 'r3k2r/ppp1bppp/8/3Np3/8/8/PPP2PPP/R3K2R w KQkq - 0 1',
  
  backRankMate: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1',               // Re8#

  // Positions where book moves exist but search should override
  bookTrapItalian: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',

  // Endgame precision
  kpkWin:  '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1',
  kpkDraw: '8/8/8/8/4k3/8/4P3/4K3 w - - 0 1',
  
  // KRK for endgame tests
  krkBasic: '8/8/8/4k3/8/8/4K3/7R w - - 0 1',
  
  // Various pawn structures
  doubledPawns: '4k3/pppppppp/8/8/4P3/4P3/PPPP1PPP/4K3 w - - 0 1',
  isolatedPawn: '4k3/ppp1pppp/8/8/3P4/8/PPP1PPPP/4K3 w - - 0 1',
  passedPawn:   '4k3/8/8/8/8/4P3/8/4K3 w - - 0 1',
};