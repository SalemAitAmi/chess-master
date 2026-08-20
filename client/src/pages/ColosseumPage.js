import { useState, useEffect, useCallback, useRef } from "react";
import { useEngine } from "../hooks/useEngine";
import { useGameSession } from "../hooks/useGameSession";
import GamePageLayout, { EngineGate } from "../components/GamePageLayout";
import ChessBoard from "../components/ChessBoard";
import GameOverModal from "../components/GameOverModal";
import GameInfoPanel from "../components/GameInfoPanel";
import MoveHistory from "../components/MoveHistory";
import CapturedPieces from "../components/CapturedPieces";
import { DIFFICULTY_NAMES, DIFFICULTY_DEPTHS, TIMEOUTS } from "../constants/gameConstants";
import { lastMoveToCoords } from "../utils/chessUtils";
import { reportFailure } from "../utils/failure";

const BTN = 'px-6 py-3 rounded-lg text-lg font-semibold transition-all';
const PANEL = 'bg-gray-800 rounded-lg p-4 shadow-lg w-64';
const NO_ROUND_RECORDED = -1;

// ═══════════════════════════════════════════════════════════════════════════
// Module helpers
// ═══════════════════════════════════════════════════════════════════════════
function botsForRound(config, round) {
  const swapped = round % 2 === 1;
  return {
    white: swapped ? config.blackBot : config.whiteBot,
    black: swapped ? config.whiteBot : config.blackBot,
  };
}

function drawLabel(status) {
  if (status === 'threefold') return 'Draw — Threefold Repetition';
  if (status === 'fifty_move') return 'Draw — 50-Move Rule';
  if (status === 'insufficient_material') return 'Draw — Insufficient Material';
  return 'Draw!';
}

// ═══════════════════════════════════════════════════════════════════════════
const ColosseumPage = ({ config, onBackToMenu }) => {
  // ═════════════════════════════════════════════════════════════════════════
  // HOOKS
  // ═════════════════════════════════════════════════════════════════════════
  const engine = useEngine();
  const session = useGameSession(engine);
  const { gameState, moveHistory, initialized, applyEngineState, startNewGame, mountedRef } = session;

  const [currentRound, setCurrentRound] = useState(0);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [moveError, setMoveError] = useState(null);

  const runningRef = useRef(false);
  const moveInProgressRef = useRef(false);
  const loopIdRef = useRef(0);
  const recordedRoundRef = useRef(NO_ROUND_RECORDED);
  const roundTimerRef = useRef(null);
  // Values the round-transition effect reads without wanting to re-run on
  // every change (see the sync effect below).
  const latestRef = useRef({ currentRound: 0, moveCount: 0, bots: botsForRound(config, 0) });

  // ═════════════════════════════════════════════════════════════════════════
  // DERIVED
  // ═════════════════════════════════════════════════════════════════════════
  const bots = botsForRound(config, currentRound);
  const gameOver = gameState.status !== 'ongoing';
  const winner = (gameState.winner === 'none' || gameState.winner === 'draw') ? null : gameState.winner;
  const lastMove = lastMoveToCoords(gameState.lastmove);
  const whiteWins = results.filter(r => r.winner === 'white').length;
  const blackWins = results.filter(r => r.winner === 'black').length;
  const draws = results.filter(r => r.winner === 'draw').length;
  const matchComplete = !running && results.length >= config.maxRounds;
  const loopActive = initialized && running && !paused && !gameOver && moveError === null;

  // ═════════════════════════════════════════════════════════════════════════
  // CALLBACKS
  // ═════════════════════════════════════════════════════════════════════════

  /* ── Single move — NO setPosition so the board keeps full undo history
       and the server can detect threefold / 50-move draws. ── */
  const makeOneMove = useCallback(async () => {
    if (moveInProgressRef.current) return false;
    moveInProgressRef.current = true;
    try {
      const current = await engine.getGameState();
      if (!current) throw new Error('gamestate returned nothing before bot move');
      if (!mountedRef.current || current.status !== 'ongoing') return false;

      const bot = current.turn === 'white' ? latestRef.current.bots.white : latestRef.current.bots.black;
      const result = await engine.go({ depth: DIFFICULTY_DEPTHS[bot] });
      if (!mountedRef.current) return false;
      if (!result.move || result.move === '(none)') {
        throw new Error(`bot returned no move (bestmove ${result.move})`);
      }

      const newState = await engine.makeMove(result.move);
      if (!mountedRef.current) return false;
      if (!applyEngineState(newState)) throw new Error(`makemove ${result.move} rejected`);
      return newState.status === 'ongoing';
    } catch (err) {
      reportFailure('ColosseumPage.makeOneMove', err);
      if (mountedRef.current) setMoveError(err.message || 'Bot move failed');
      return false;
    } finally {
      moveInProgressRef.current = false;
    }
  }, [engine, applyEngineState, mountedRef]);

  const resetBoardForRound = useCallback(async () => {
    moveInProgressRef.current = false;
    setMoveError(null);
    await startNewGame();
  }, [startNewGame]);

  const handleStart = useCallback(() => { setMoveError(null); setRunning(true); setPaused(false); }, []);
  const handlePause = useCallback(() => setPaused(true), []);
  const handleResume = useCallback(() => { setMoveError(null); setPaused(false); }, []);
  const handleStop = useCallback(() => {
    setRunning(false);
    runningRef.current = false;
    engine.stop();
  }, [engine]);

  const handleRestart = useCallback(async () => {
    clearTimeout(roundTimerRef.current);
    setRunning(false);
    runningRef.current = false;
    setPaused(false);
    setCurrentRound(0);
    setResults([]);
    recordedRoundRef.current = NO_ROUND_RECORDED;
    await resetBoardForRound();
  }, [resetBoardForRound]);

  // ═════════════════════════════════════════════════════════════════════════
  // EFFECTS
  // ═════════════════════════════════════════════════════════════════════════

  // Sync latest values for effects that must not re-run on every change.
  useEffect(() => {
    latestRef.current = { currentRound, moveCount: moveHistory.length, bots };
  });

  useEffect(() => { runningRef.current = running && !paused; }, [running, paused]);

  useEffect(() => () => {
    runningRef.current = false;
    clearTimeout(roundTimerRef.current);
  }, []);

  // Move loop. One chain per activation; loopIdRef invalidates stale chains.
  useEffect(() => {
    if (!loopActive) return;
    loopIdRef.current += 1;
    const myLoop = loopIdRef.current;
    const step = async () => {
      if (!mountedRef.current || !runningRef.current || loopIdRef.current !== myLoop) return;
      const canContinue = await makeOneMove();
      if (canContinue && mountedRef.current && runningRef.current && loopIdRef.current === myLoop) {
        setTimeout(step, TIMEOUTS.COLOSSEUM_MOVE_DELAY);
      }
    };
    const timer = setTimeout(step, TIMEOUTS.COLOSSEUM_MOVE_DELAY);
    return () => { clearTimeout(timer); loopIdRef.current += 1; };
  }, [loopActive, makeOneMove, mountedRef]);

  // Round transition. Records the result once per round, then advances.
  useEffect(() => {
    if (!running || gameState.status === 'ongoing') return;
    const round = latestRef.current.currentRound;
    if (recordedRoundRef.current === round) return;
    recordedRoundRef.current = round;

    const result = {
      round: round + 1,
      winner: gameState.winner === 'none' ? 'draw' : gameState.winner,
      status: gameState.status,
      moves: latestRef.current.moveCount,
      whiteBot: latestRef.current.bots.white,
      blackBot: latestRef.current.bots.black,
    };
    setResults(prev => [...prev, result]);

    if (round + 1 >= config.maxRounds) {
      setRunning(false);
      runningRef.current = false;
      return;
    }

    roundTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      setCurrentRound(r => r + 1);
      await resetBoardForRound();
    }, TIMEOUTS.COLOSSEUM_ROUND_DELAY);
    return () => clearTimeout(roundTimerRef.current);
  }, [gameState.status, gameState.winner, running, config.maxRounds, resetBoardForRound, mountedRef]);

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════
  const banner = moveError !== null ? (
    <div className="px-4 py-2 bg-red-900 rounded-lg text-red-200 flex items-center gap-3">
      <span>⚠ Bot move failed: <span className="font-mono text-sm">{moveError}</span></span>
      <button onClick={handleResume} className="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-sm">Retry</button>
    </div>
  ) : gameOver && running ? (
    <div className="px-6 py-2 bg-gray-700 rounded-lg text-center">
      <span className="text-xl font-bold text-white">{winner ? `${winner} wins!` : drawLabel(gameState.status)}</span>
      <span className="ml-4 text-gray-400">Next round...</span>
    </div>
  ) : running && !paused ? (
    <div className="px-4 py-2 bg-gray-700 rounded-lg text-gray-300 animate-pulse">
      🤖 {DIFFICULTY_NAMES[gameState.turn === 'white' ? bots.white : bots.black]} ({gameState.turn}) is thinking...
    </div>
  ) : null;

  const scoreCard = (
    <div className={PANEL}>
      <h3 className="text-lg font-bold text-white mb-4 border-b border-gray-600 pb-2">Match Score</h3>
      <div className="grid grid-cols-3 gap-4 text-center mb-4">
        <div><div className="text-2xl font-bold text-yellow-300">{whiteWins}</div><div className="text-xs text-gray-400">White</div></div>
        <div><div className="text-2xl font-bold text-gray-400">{draws}</div><div className="text-xs text-gray-400">Draw</div></div>
        <div><div className="text-2xl font-bold text-gray-300">{blackWins}</div><div className="text-xs text-gray-400">Black</div></div>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-gray-400">Status:</span>
        <span className={`font-bold ${running && !paused ? 'text-green-400' : 'text-gray-400'}`}>
          {running ? (paused ? 'Paused' : 'Running') : 'Stopped'}
        </span>
      </div>
      {results.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-600">
          <h4 className="text-sm font-bold text-gray-300 mb-2">History</h4>
          <div className="max-h-40 overflow-y-auto space-y-1 text-xs move-history-scroll">
            {results.map((r, i) => (
              <div key={i} className="flex justify-between text-gray-400">
                <span>Round {r.round}</span>
                <span className={r.winner === 'white' ? 'text-yellow-300' : r.winner === 'black' ? 'text-gray-300' : 'text-gray-500'}>
                  {r.winner === 'draw' ? `Draw (${r.status})` : r.winner} ({r.moves})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <EngineGate engine={engine} session={session} onBackToMenu={onBackToMenu}>
      <GamePageLayout
        title="⚔️ Colosseum ⚔️"
        subtitle={`Round ${currentRound + 1} / ${config.maxRounds} • ${DIFFICULTY_NAMES[bots.white]} (White) vs ${DIFFICULTY_NAMES[bots.black]} (Black)`}
        onBackToMenu={onBackToMenu}

        /* ── BANNER ── */
        banner={banner}

        /* ── LEFT ── */
        leftPanels={
          <>
            <GameInfoPanel gameState={gameState} />
            <CapturedPieces
              capturedWhite={gameState.captured_white}
              capturedBlack={gameState.captured_black}
            />
            {scoreCard}
          </>
        }

        /* ── BOARD ── */
        board={
          <ChessBoard
            fen={gameState.fen}
            selected={null}
            legalMoves={[]}
            lastMove={lastMove}
            onSquareClick={() => {}}
            flipped={currentRound % 2 === 1}
            disabled={true}
          />
        }

        /* ── CONTROLS ── */
        controls={
          <>
            {!running ? (
              <button onClick={handleStart} className={`${BTN} bg-green-600 hover:bg-green-700 text-white`}>
                {results.length > 0 && !matchComplete ? 'Continue' : 'Start Match'}
              </button>
            ) : paused ? (
              <button onClick={handleResume} className={`${BTN} bg-green-600 hover:bg-green-700 text-white`}>Resume</button>
            ) : (
              <button onClick={handlePause} className={`${BTN} bg-yellow-600 hover:bg-yellow-700 text-white`}>Pause</button>
            )}
            {running && (
              <button onClick={handleStop} className={`${BTN} bg-red-600 hover:bg-red-700 text-white`}>Stop</button>
            )}
            {!running && results.length > 0 && (
              <button onClick={handleRestart} className={`${BTN} bg-blue-600 hover:bg-blue-700 text-white`}>New Match</button>
            )}
          </>
        }

        /* ── RIGHT ── */
        rightPanels={<MoveHistory history={moveHistory} />}

        /* ── FOOTER ── */
        footer={matchComplete ? (
          <div className="px-8 py-4 bg-purple-900 rounded-lg text-center">
            <h2 className="text-2xl font-bold text-white mb-2">Match Complete!</h2>
            <div className="text-gray-300">Final: White {whiteWins} - {draws} - {blackWins} Black</div>
            <div className="text-lg font-bold mt-2 text-purple-300">
              {whiteWins > blackWins ? 'White Wins!' : blackWins > whiteWins ? 'Black Wins!' : 'Draw!'}
            </div>
          </div>
        ) : null}

        /* ── OVERLAYS ── */
        overlays={
          <GameOverModal gameOver={gameOver && !running} winner={winner} status={gameState.status} onRestart={handleRestart} />
        }
      />
    </EngineGate>
  );
};

export default ColosseumPage;