import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useEngine } from '../hooks/useEngine';
import { useGameSession, useStartFen } from '../hooks/useGameSession';
import GamePageLayout, { EngineGate } from '../components/GamePageLayout';
import ChessBoard from '../components/ChessBoard';
import GameOverModal from '../components/GameOverModal';
import GameInfoPanel from '../components/GameInfoPanel';
import MoveHistory from '../components/MoveHistory';
import CapturedPieces from '../components/CapturedPieces';
import MatchScore, { tallyMatch, matchVerdict } from '../components/MatchScore';
import { Banner, Button } from '../components/primitives';
import { DIFFICULTY_NAMES, DIFFICULTY_DEPTHS, TIMEOUTS } from '../constants/gameConstants';
import { lastMoveToCoords, winnerColor } from '../utils/chessUtils';
import { reportFailure } from '../utils/failure';

// ═══════════════════════════════════════════════════════════════════════════
// Module helpers
//
// Two engine INSTANCES, "A" and "B", each on its own WebSocket with its own
// profile, config and transposition table. Colours alternate each round by
// deciding which instance plays white — the instances never change config, so
// a profile stays bound to one table and one log `eng` id for the whole match.
// ═══════════════════════════════════════════════════════════════════════════

const NO_ROUND_RECORDED = -1;
const ENGINE_ACCENT = { A: 'text-cyan-300', B: 'text-pink-300' };
const DRAW_LABELS = {
  threefold: 'Draw — Threefold Repetition',
  fifty_move: 'Draw — 50-Move Rule',
  insufficient_material: 'Draw — Insufficient Material',
};

const aPlaysWhite = (round) => round % 2 === 0;
const engineName = (id) => `Engine ${id}`;
const drawLabel = (status) => DRAW_LABELS[status] ?? 'Draw!';
const botLabel = (bot) => `${DIFFICULTY_NAMES[bot.depth]}/${bot.profile}`;

/** A contestant's fixed identity: id, depth setting, profile. */
function contestant(config, id) {
  return id === 'A'
    ? { id, depth: config.botA ?? 3, profile: config.profileA || 'baseline' }
    : { id, depth: config.botB ?? 3, profile: config.profileB || 'baseline' };
}

function botsForRound(config, round) {
  const a = contestant(config, 'A'), b = contestant(config, 'B');
  return aPlaysWhite(round) ? { white: a, black: b } : { white: b, black: a };
}

// ═══════════════════════════════════════════════════════════════════════════

const ColosseumPage = ({ config, onBackToMenu }) => {
  // ── Engines ──
  // One session id per mounted match. Both sockets join it; the server rotates
  // the log game directory once BOTH instances have sent ucinewgame.
  const sessionIdRef = useRef(`colosseum-${Date.now().toString(36)}`);
  const sessionId = sessionIdRef.current;
  const engineA = useEngine(undefined, { session: sessionId, instance: 'A', profile: config.profileA || 'baseline', role: 'contestant' });
  const engineB = useEngine(undefined, { session: sessionId, instance: 'B', profile: config.profileB || 'baseline', role: 'contestant' });

  // ── Session ──
  // Engine A is the ARBITER: its gamestate is rendered. Engine B is the
  // shadow: every move is mirrored to it so both boards stay identical and
  // each keeps full history for threefold / 50-move detection.
  const startFen = useStartFen();
  const session = useGameSession(engineA, { startFen });
  const { gameState, moveHistory, initialized, applyEngineState, startNewGame, mountedRef } = session;

  // ── State ──
  const [currentRound, setCurrentRound] = useState(0);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [moveError, setMoveError] = useState(null);
  const [shadowReady, setShadowReady] = useState(false);

  // ── Refs ──
  const runningRef = useRef(false);                    // read by the async move loop
  const moveInProgressRef = useRef(false);             // one makeOneMove at a time
  const loopIdRef = useRef(0);                         // invalidates stale loop chains
  const recordedRoundRef = useRef(NO_ROUND_RECORDED);  // each round recorded once
  const roundTimerRef = useRef(null);
  const shadowInitRef = useRef(false);
  // Snapshot for async code that must not close over a stale render.
  const latestRef = useRef({ currentRound: 0, moveCount: 0, bots: botsForRound(config, 0) });

  // ── Derived ──
  // Combined view of both connections for the gate and the controls; both
  // must be UCI-ready before the page is usable.
  const engines = useMemo(() => ({
    connected: engineA.connected && engineB.connected,
    error: engineA.error || engineB.error,
    reconnect: () => { engineA.reconnect(); engineB.reconnect(); },
    stop: () => { engineA.stop(); engineB.stop(); },
  }), [engineA, engineB]);

  const bots = botsForRound(config, currentRound);
  const gameOver = gameState.status !== 'ongoing';
  const winner = winnerColor(gameState);
  const winnerBot = winner ? bots[winner] : null;
  const thinkingBot = gameState.turn === 'white' ? bots.white : bots.black;
  const sides = ['A', 'B'].map(id => ({
    id, name: engineName(id), short: id, detail: botLabel(contestant(config, id)),
    accent: ENGINE_ACCENT[id],
    playing: bots.white.id === id ? 'white' : 'black',
    connected: id === 'A' ? engineA.connected : engineB.connected,
  }));
  const tally = tallyMatch(results, sides);
  const matchComplete = !running && results.length >= config.maxRounds;
  const loopActive = initialized && shadowReady && running && !paused && !gameOver && moveError === null;

  // ── Callbacks ──

  const engineFor = useCallback((botId) => (botId === 'A' ? engineA : engineB), [engineA, engineB]);

  /**
   * One move. The mover searches; the move is applied to BOTH boards and the
   * resulting FENs must match. No setPosition anywhere, so both engines keep
   * full undo/repetition history.
   * @returns {Promise<boolean>} true while the game continues
   */
  const makeOneMove = useCallback(async () => {
    if (moveInProgressRef.current) return false;
    moveInProgressRef.current = true;
    try {
      const roundBots = latestRef.current.bots;
      const moverBot = gameState.turn === 'white' ? roundBots.white : roundBots.black;
      const shadowBot = gameState.turn === 'white' ? roundBots.black : roundBots.white;
      const mover = engineFor(moverBot.id);
      const shadow = engineFor(shadowBot.id);

      const current = await mover.getGameState();
      if (!current) throw new Error('gamestate returned nothing before bot move');
      if (!mountedRef.current || current.status !== 'ongoing') return false;
      if (current.turn !== gameState.turn) {
        throw new Error(`board desync: page says ${gameState.turn}, engine ${moverBot.id} says ${current.turn}`);
      }

      const result = await mover.go({ depth: DIFFICULTY_DEPTHS[moverBot.depth] });
      if (!mountedRef.current) return false;
      if (!result.move || result.move === '(none)') throw new Error(`bot ${moverBot.id} returned no move (bestmove ${result.move})`);

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

  /**
   * Reset the shadow board to the same start as the arbiter.
   * useGameSession only resets engine A, so B must receive the start FEN here
   * too — without it a custom start position desynced on the first move.
   * @returns {Promise<boolean>} true when the shadow board is at the start
   */
  const resetShadow = useCallback(async () => {
    setShadowReady(false);
    try {
      await engineB.newGame();
      if (startFen !== '') await engineB.setPosition(startFen);
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

  // ── Effects ──

  // Refresh the async snapshot after every render.
  useEffect(() => {
    latestRef.current = { currentRound, moveCount: moveHistory.length, bots };
  });

  useEffect(() => { runningRef.current = running && !paused; }, [running, paused]);

  // Unmount: stop the loop and any pending round transition.
  useEffect(() => () => {
    runningRef.current = false;
    clearTimeout(roundTimerRef.current);
  }, []);

  // Engine B needs the same reset as A once it is UCI-ready; the latch is
  // cleared on disconnect so a reconnect retries.
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
    if (!loopActive) return undefined;
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

  // Round transition: record the result once per round, then advance.
  useEffect(() => {
    if (!running || gameState.status === 'ongoing') return undefined;
    const round = latestRef.current.currentRound;
    if (recordedRoundRef.current === round) return undefined;
    recordedRoundRef.current = round;

    const rb = latestRef.current.bots;
    const wc = winnerColor(gameState);
    setResults(prev => [...prev, {
      round: round + 1,
      winnerId: wc ? rb[wc].id : null,
      winnerColor: wc, status: gameState.status, moves: latestRef.current.moveCount,
      whiteId: rb.white.id, blackId: rb.black.id,
    }]);

    if (round + 1 >= config.maxRounds) {
      setRunning(false);
      runningRef.current = false;
      return undefined;
    }
    roundTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      setCurrentRound(r => r + 1);
      await resetBoardForRound();
    }, TIMEOUTS.COLOSSEUM_ROUND_DELAY);
    return () => clearTimeout(roundTimerRef.current);
    // gameState is read only for status/winner, which are the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.status, gameState.winner, running, config.maxRounds, resetBoardForRound, mountedRef]);

  // ── Render ──

  let banner = null;
  if (moveError !== null) {
    banner = (
      <Banner tone="error">
        <span>⚠ Bot move failed: <span className="font-mono text-sm">{moveError}</span></span>
        <Button size="sm" tone="danger" onClick={handleResume}>Retry</Button>
      </Banner>
    );
  } else if (gameOver && running) {
    banner = (
      <Banner>
        <span className="text-xl font-bold text-white">
          {winnerBot ? `${engineName(winnerBot.id)} wins! (${winner})` : drawLabel(gameState.status)}
        </span>
        <span className="text-gray-400">Next round...</span>
      </Banner>
    );
  } else if (running && !paused) {
    banner = <Banner pulse>🤖 {botLabel(thinkingBot)} ({gameState.turn}, engine {thinkingBot.id}) is thinking...</Banner>;
  } else if (!shadowReady) {
    banner = <Banner pulse>Synchronising engines...</Banner>;
  }

  const controls = (
    <>
      {!running && (
        <Button size="lg" tone="success" disabled={!shadowReady} onClick={handleStart}>
          {results.length > 0 && !matchComplete ? 'Continue' : 'Start Match'}
        </Button>
      )}
      {running && paused && <Button size="lg" tone="success" onClick={handleResume}>Resume</Button>}
      {running && !paused && <Button size="lg" tone="warning" onClick={handlePause}>Pause</Button>}
      {running && <Button size="lg" tone="danger" onClick={handleStop}>Stop</Button>}
      {!running && results.length > 0 && <Button size="lg" tone="primary" onClick={handleRestart}>New Match</Button>}
    </>
  );

  const matchFooter = matchComplete ? (
    <div className="px-8 py-4 bg-purple-900 rounded-lg text-center">
      <h2 className="text-2xl font-bold text-white mb-2">Match Complete!</h2>
      <div className="text-gray-300">Final: Engine A {tally.A} – {tally.draws} – {tally.B} Engine B</div>
      <div className="text-lg font-bold mt-2 text-purple-300">{matchVerdict(results, sides)}</div>
    </div>
  ) : null;

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
            <MatchScore sides={sides} results={results}
              status={
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Status:</span>
                  <span className={`font-bold ${running && !paused ? 'text-green-400' : 'text-gray-400'}`}>
                    {running ? (paused ? 'Paused' : 'Running') : 'Stopped'}
                  </span>
                </div>
              }>
              <div className="mt-2 text-xs font-mono text-gray-500 truncate" title={sessionId}>{sessionId}</div>
            </MatchScore>
          </>
        }
        board={
          <ChessBoard fen={gameState.fen} lastMove={lastMoveToCoords(gameState.lastmove)}
            onSquareClick={() => {}} flipped={!aPlaysWhite(currentRound)} disabled />
        }
        controls={controls}
        rightPanels={<MoveHistory history={moveHistory} startFen={startFen} />}
        footer={matchFooter}
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