/**
 * SMP worker thread. Receives a position + root bias via message, runs an
 * independent search, posts the result back.
 *
 * Not spawned by the current pipeline. Kept in sync with SearchEngine's
 * options so step 2 of the transition (one worker) is a wiring change only.
 */
import { parentPort, workerData } from 'worker_threads';
import { Board } from '../core/board.js';
import { SearchEngine } from './search.js';
import { DEFAULT_CONFIG } from '../core/constants.js';

const { threadIndex } = workerData;

// Workers are identical; diversity comes from the root bias, not from config.
const config = { ...DEFAULT_CONFIG, threads: 1 };
const engine = new SearchEngine(config);

parentPort.on('message', (msg) => {
  if (msg.type === 'search') {
    let result;
    try {
      const board = Board.fromFen(msg.fen);
      const rootBias = msg.rootBias instanceof Map ? msg.rootBias : null;
      result = engine.search(board, msg.depth, { rootBias });
    } catch (err) {
      parentPort.postMessage({ type: 'error', threadIndex, message: err.message, stack: err.stack });
      return;
    }
    parentPort.postMessage({
      type: 'result',
      threadIndex,
      move: result.bestMove !== null ? result.bestMove.algebraic : null,
      score: result.score,
      depth: result.depth,
      nodes: result.nodes,
    });
  } else if (msg.type === 'stop') {
    engine.stop();
  }
});