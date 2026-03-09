import { legalMoves, evalLine, printEvalLine, traceQSearch, searchOnce, depthSweep } from './harness/introspect.js';

const FORK = 'r3k2r/ppp2ppp/2n5/3Np3/8/8/PPP2PPP/R3K2R w KQkq - 0 1';

// ── Step 0: Is e1g1 even legal? (Would have caught the fixture bug.) ──
console.log(legalMoves(FORK).moves.includes('e1g1'));   // → true with KQkq, false with -

// ── Step 1: Does static eval see the material correctly? ──
// Play the fork line by hand and watch material at each step.
const line = evalLine(FORK, ['d5c7', 'e8f8', 'c7a8']);
printEvalLine(line);
// Expect material column:  -100 (start, black +1P)
//                       →    0 (after Nxc7, pawn captured)
//                       →    0 (after Kf8, no material change)
//                       → +500 (after Nxa8, rook captured)
// If the last row isn't ~+500, evaluateMaterial is broken.

// ── Step 2: Does quiescence follow the capture chain? ──
// Start q-search from AFTER Nxc7+ (black to move, in check).
const afterFork = 'r3k2r/ppN2ppp/2n5/4p3/8/8/PPP2PPP/R3K2R b KQkq - 0 1';
const qt = traceQSearch(afterFork);
console.log('Q-search score (black perspective):', qt.score);       // Expect ~−500
console.log('Nodes visited:', qt.nodesVisited);
console.log('Max depth reached:', qt.maxDepthReached);              // Expect ≥ 2 (Kf8, Nxa8)
// If score isn't strongly negative, q-search isn't finding Nxa8.

// ── Step 3: Does a clean depth-4 search find it? ──
// No ID, no TT carryover from prior iterations — isolates alpha-beta.
const s4 = searchOnce(FORK, 4);
console.log('Best:', s4.bestMove, 'Score:', s4.score);               // Expect d5c7, ~+500
console.table(s4.rootMoves.slice(0, 5));

// ── Step 4: Does iterative deepening agree at every depth? ──
// Sign flips between odd/even → perspective bug. Best-move instability → ordering issue.
console.table(depthSweep(FORK, 6));
// Expect d5c7 as best at every depth ≥ 1, score stable around +500.