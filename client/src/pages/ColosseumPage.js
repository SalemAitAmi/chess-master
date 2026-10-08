import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { getSettings } from "../config/settings";

import MatchScore, { tallyMatch, matchVerdict } from "../components/MatchScore";


const BTN = 'px-6 py-3 rounded-lg text-lg font-semibold transition-all';
const PANEL = 'bg-gray-800 rounded-lg p-4 shadow-lg w-64';
const NO_ROUND_RECORDED = -1;

// ═══════════════════════════════════════════════════════════════════════════
// Module helpers
//
// Two engine INSTANCES, "A" and "B", each on its own WebSocket with its own
// profile, config and transposition table. Colours alternate each round by
// deciding which instance plays white — the instances never change config, so
// a profile stays bound to one table and one log `eng` id for the whole match.
// ═══════════════════════════════════════════════════════════════════════════

// Two engine INSTANCES, "A" and "B", each on its own WebSocket with its own
// profile, config and transposition table. Colours alternate each round by
// deciding which instance plays white — the instances never change config, so
// a profile stays bound to one table and one log `eng` id for the whole match.
function aPlaysWhite(round) { return round % 2 === 0; }

function botsForRound(config, round) {
  const A = { depth: config.botA ?? 3, profile: config.profileA || 'baseline', id: 'A' };
  const B = { depth: config.botB ?? 3, profile: config.profileB || 'baseline', id: 'B' };
  return aPlaysWhite(round) ? { white: A, black: B } : { white: B, black: A };
}

function drawLabel(status) {
  if (status === 'threefold') return 'Draw — Threefold Repetition';
  if (status === 'fifty_move') return 'Draw — 50-Move Rule';
  if (status === 'insufficient_material') return 'Draw — Insufficient Material';
  return 'Draw!';
}

function botLabel(bot) { return `${DIFFICULTY_NAMES[bot.depth]}/${bot.profile}`; }

const ENGINE_ACCENT = { A: 'text-cyan-300', B: 'text-pink-300' };

function engineName(id) { return `Engine ${id}`; }

function botById(config, id) {
  const r0 = botsForRound(config, 0);
  return r0.white.id === id ? r0.white : r0.black;
}

// ═══════════════════════════════════════════════════════════════════════════

const ColosseumPage = ({ config, onBackToMenu }) => {
  // ═════════════════════════════════════════════════════════════════════════
  // HOOKS
  // ═════════════════════════════════════════════════════════════════════════
  // One session id per mounted match. Both sockets join it; the server rotates
  // the game directory once BOTH instances have sent ucinewgame.
  const sessionIdRef = useRef(`colosseum-${Date.now().toString(36)}`);
  const sessionId = sessionIdRef.current;

  const engineA = useEngine(undefined, { session: sessionId, instance: 'A', profile: config.profileA || 'baseline', role: 'contestant' });
  const engineB = useEngine(undefined, { session: sessionId, instance: 'B', profile: config.profileB || 'baseline', role: 'contestant' });

  // The session hook owns the displayed board via engine A. Engine B is the
  // shadow: every move is mirrored to it so both boards stay identical and
  // each keeps full history for threefold / 50-move detection.
  const startFen = getSettings().client.startFen
  const session = useGameSession(engineA, { startFen });
  const { gameState, moveHistory, initialized, applyEngineState, startNewGame, mountedRef } = session;

  const [currentRound, setCurrentRound] = useState(0);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [moveError, setMoveError] = useState(null);
  const [shadowReady, setShadowReady] = useState(false);

  const runningRef = useRef(false);
  const moveInProgressRef = useRef(false);
  const loopIdRef = useRef(0);
  const recordedRoundRef = useRef(NO_ROUND_RECORDED);
  const roundTimerRef = useRef(null);
  const shadowInitRef = useRef(false);
  const latestRef = useRef({ currentRound: 0, moveCount: 0, bots: botsForRound(config, 0) });

  // Combined view of both connections, for the gate and the controls. Both
  // must be UCI-ready before the page is usable.
  const engines = useMemo(() => ({
    connected: engineA.connected && engineB.connected,
    error: engineA.error || engineB.error,
    reconnect: () => { engineA.reconnect(); engineB.reconnect(); },
    stop: () => { engineA.stop(); engineB.stop(); },
  }), [engineA, engineB]);

  // ═════════════════════════════════════════════════════════════════════════
  // DERIVED
  // ═════════════════════════════════════════════════════════════════════════
  const bots = botsForRound(config, currentRound);
  const gameOver = gameState.status !== 'ongoing';
  const winner = (gameState.winner === 'none' || gameState.winner === 'draw') ? null : gameState.winner;
  const lastMove = lastMoveToCoords(gameState.lastmove);
  const winnerBot = winner ? (winner === 'white' ? bots.white : bots.black) : null;
  const sides = ['A', 'B'].map(id => ({
    id, name: engineName(id), short: id, detail: botLabel(botById(config, id)),
    accent: ENGINE_ACCENT[id],
    playing: (bots.white.id === id) ? 'white' : 'black',
    connected: id === 'A' ? engineA.connected : engineB.connected,
  }));
  const tally = tallyMatch(results, sides);
  const matchComplete = !running && results.length >= config.maxRounds;
  const loopActive = initialized && shadowReady && running && !paused && !gameOver && moveError === null;

  // ═════════════════════════════════════════════════════════════════════════
  // CALLBACKS
  // ═════════════════════════════════════════════════════════════════════════
  const engineFor = useCallback((botId) => (botId === 'A' ? engineA : engineB), [engineA, engineB]);

  /* ── Single move. The mover searches; the move is applied to BOTH boards.
       No setPosition anywhere, so both engines retain full undo history. ── */
  const makeOneMove = useCallback(async () => {
    if (moveInProgressRef.current) return false;
    moveInProgressRef.current = true;
    try {
      const roundBots = latestRef.current.bots;
      const moverBot  = gameState.turn === 'white' ? roundBots.white : roundBots.black;
      const shadowBot = gameState.turn === 'white' ? roundBots.black : roundBots.white;
      const mover  = engineFor(moverBot.id);
      const shadow = engineFor(shadowBot.id);

      const current = await mover.getGameState();
      if (!current) throw new Error('gamestate returned nothing before bot move');
      if (!mountedRef.current || current.status !== 'ongoing') return false;
      if (current.turn !== gameState.turn) {
        throw new Error(`board desync: page says ${gameState.turn}, engine ${moverBot.id} says ${current.turn}`);
      }

      const result = await mover.go({ depth: DIFFICULTY_DEPTHS[moverBot.depth] });
      if (!mountedRef.current) return false;
      if (!result.move || result.move === '(none)') {
        throw new Error(`bot ${moverBot.id} returned no move (bestmove ${result.move})`);
      }

      const newState = await mover.makeMove(result.move);
      if (!mountedRef.current) return false;
      const shadowState = await shadow.makeMove(result.move);
      if (!mountedRef.current) return false;
      if (shadowState.fen !== newState.fen) {
        throw new Error(`board desync after ${result.move}: ${newState.fen} vs ${shadowState.fen}`);
      }

      if (!applyEngineState(newState)) throw new Error(`makemove ${result.move} rejected`);
      return newState.status === 'ongoing';
    } catch (err) {
      reportFailure('ColosseumPage.makeOneMove', err);
      if (mountedRef.current) setMoveError(err.message || 'Bot move failed');
      return false;
    } finally {
      moveInProgressRef.current = false;
    }
  }, [gameState.turn, engineFor, applyEngineState, mountedRef]);

  /** @returns {Promise<boolean>} true when the shadow board is at the start. */
  const resetShadow = useCallback(async () => {
    setShadowReady(false);
    try {
      await engineB.newGame();
      if (mountedRef.current) setShadowReady(true);
      return true;
    } catch (err) {
      reportFailure('ColosseumPage.resetShadow', err);
      if (mountedRef.current) setMoveError(err.message || 'Shadow engine reset failed');
      return false;
    }
  }, [engineB, mountedRef, startFen]);

  const resetBoardForRound = useCallback(async () => {
    moveInProgressRef.current = false;
    setMoveError(null);
    await Promise.all([startNewGame(), resetShadow()]);
  }, [startNewGame, resetShadow]);

  const handleStart = useCallback(() => { setMoveError(null); setRunning(true); setPaused(false); }, []);
  const handlePause = useCallback(() => setPaused(true), []);
  const handleResume = useCallback(() => { setMoveError(null); setPaused(false); }, []);

  const handleStop = useCallback(() => {
    setRunning(false);
    runningRef.current = false;
    engines.stop();
  }, [engines]);

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
  useEffect(() => {
    latestRef.current = { currentRound, moveCount: moveHistory.length, bots };
  });

  useEffect(() => { runningRef.current = running && !paused; }, [running, paused]);

  useEffect(() => () => {
    runningRef.current = false;
    clearTimeout(roundTimerRef.current);
  }, []);

  // useGameSession initialises engine A. Engine B needs the same reset once it
  // is UCI-ready; the latch is cleared on disconnect so a reconnect retries.
  useEffect(() => {
    if (!engineB.connected) {
      shadowInitRef.current = false;
      setShadowReady(false);
      return;
    }
    if (shadowInitRef.current) return;
    shadowInitRef.current = true;
    resetShadow().then(ok => { if (!ok) shadowInitRef.current = false; });
  }, [engineB.connected, resetShadow]);

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

    const rb = latestRef.current.bots;
    const winnerColor = gameState.winner === 'white' || gameState.winner === 'black' ? gameState.winner : null;
    setResults(prev => [...prev, {
      round: round + 1,
      winnerId: winnerColor === 'white' ? rb.white.id : winnerColor === 'black' ? rb.black.id : null,
      winnerColor, status: gameState.status, moves: latestRef.current.moveCount,
      whiteId: rb.white.id, blackId: rb.black.id,
    }]);

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
  const thinkingBot = gameState.turn === 'white' ? bots.white : bots.black;

  const banner = moveError !== null ? (
    <div className="px-4 py-2 bg-red-900 rounded-lg text-red-200 flex items-center gap-3">
      <span>⚠ Bot move failed: <span className="font-mono text-sm">{moveError}</span></span>
      <button onClick={handleResume} className="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-sm">Retry</button>
    </div>
  ) : gameOver && running ? (
    <div className="px-6 py-2 bg-gray-700 rounded-lg text-center">
      <span className="text-xl font-bold text-white">
        {winnerBot ? `${engineName(winnerBot.id)} wins! (${winner})` : drawLabel(gameState.status)}
      </span>
      <span className="ml-4 text-gray-400">Next round...</span>
    </div>
  ) : running && !paused ? (
    <div className="px-4 py-2 bg-gray-700 rounded-lg text-gray-300 animate-pulse">
      🤖 {botLabel(thinkingBot)} ({gameState.turn}, engine {thinkingBot.id}) is thinking...
    </div>
  ) : !shadowReady ? (
    <div className="px-4 py-2 bg-gray-700 rounded-lg text-gray-300 animate-pulse">Synchronising engines...</div>
  ) : null;

  const scoreCard = (
    <MatchScore
      sides={sides}
      results={results}
      status={
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Status:</span>
          <span className={`font-bold ${running && !paused ? 'text-green-400' : 'text-gray-400'}`}>
            {running ? (paused ? 'Paused' : 'Running') : 'Stopped'}
          </span>
        </div>
      }
    >
      <div className="mt-2 text-xs font-mono text-gray-500 truncate">{sessionId}</div>
    </MatchScore>
  );

  return (
    <EngineGate engine={engines} session={session} onBackToMenu={onBackToMenu}>
      <GamePageLayout
        title="⚔️ Colosseum ⚔️"
        subtitle={`Round ${currentRound + 1} / ${config.maxRounds} • ${botLabel(bots.white)} (White) vs ${botLabel(bots.black)} (Black)`}
        onBackToMenu={onBackToMenu}
        banner={banner}
        leftPanels={
          <>
            <GameInfoPanel gameState={gameState} />
            <CapturedPieces capturedWhite={gameState.captured_white} capturedBlack={gameState.captured_black} />
            {scoreCard}
          </>
        }
        board={
          <ChessBoard
            fen={gameState.fen}
            selected={null}
            legalMoves={[]}
            lastMove={lastMove}
            onSquareClick={() => {}}
            flipped={!aPlaysWhite(currentRound)}
            disabled={true}
          />
        }
        controls={
          <>
            {!running ? (
              <button onClick={handleStart} disabled={!shadowReady}
                className={`${BTN} ${shadowReady ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 cursor-not-allowed'} text-white`}>
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
        rightPanels={<MoveHistory history={moveHistory} startFen={startFen} />}
        footer={matchComplete ? (
          <div className="px-8 py-4 bg-purple-900 rounded-lg text-center">
            <h2 className="text-2xl font-bold text-white mb-2">Match Complete!</h2>
            <div className="text-gray-300">
              Final: Engine A {tally.A} – {tally.draws} – {tally.B} Engine B
            </div>
            <div className="text-lg font-bold mt-2 text-purple-300">{matchVerdict(results, sides)}</div>
          </div>
        ) : null}
        overlays={
          <GameOverModal gameOver={gameOver && !running} winner={winner}
            winnerName={winnerBot ? engineName(winnerBot.id) : null}
            status={gameState.status} onRestart={handleRestart} />
        }
      />
    </EngineGate>
  );
};

export default ColosseumPage;