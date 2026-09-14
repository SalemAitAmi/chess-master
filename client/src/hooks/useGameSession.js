/**
 * Game session — the state every page shares: the engine's gamestate block,
 * the client-side SAN history (the engine only sends a 20-move window), the
 * init/restart lifecycle, and a busy flag.
 *
 * MULTI-ENGINE. Accepts either one engine or an array of engines. With an
 * array, engines[0] is the ARBITER: its gamestate block is the one rendered.
 * Every engine receives `ucinewgame` (and, from the page, every `makemove`),
 * so each keeps its own independent board and can detect threefold / 50-move
 * on its own. The engines are read through a ref so this hook's callbacks stay
 * stable even though `useEngine` returns a new object on every status change.
 *
 * Failure paths:
 *   - ucinewgame/gamestate rejects        → sessionError, stack dumped
 *   - gamestate block without a fen       → sessionError
 *   - no gamestate within INIT_WATCHDOG   → sessionError ("engine did not respond")
 * A page never sits on "Initializing" without a reason and a retry button.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { INITIAL_GAME_STATE, TIMEOUTS } from '../constants/gameConstants';
import { reportFailure } from '../utils/failure';

export function useGameSession(engineOrEngines) {
  // ── Hooks: state ──
  const [gameState, setGameState] = useState(INITIAL_GAME_STATE);
  const [moveHistory, setMoveHistory] = useState([]);
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionError, setSessionError] = useState(null);

  // ── Hooks: refs ──
  const mountedRef = useRef(true);
  const initStartedRef = useRef(false);
  const enginesRef = useRef([]);

  // Updated on every render; read (never closed over) by the callbacks below.
  enginesRef.current = Array.isArray(engineOrEngines) ? engineOrEngines : [engineOrEngines];

  // Primitive, so effects depending on it are stable.
  const allConnected = enginesRef.current.length > 0 &&
                       enginesRef.current.every(e => e && e.connected);

  // ── Callbacks: state mutation ──
  /**
   * Merge an engine gamestate block. `appendHistory` must be false for undo
   * (the returned block's lastmovesan is the move BEFORE the undone one and
   * would otherwise be pushed twice).
   */
  const applyEngineState = useCallback((state, appendHistory = true) => {
    if (!state || typeof state.fen !== 'string') {
      reportFailure('useGameSession.applyEngineState', new Error(`invalid state: ${JSON.stringify(state)}`));
      return false;
    }
    setGameState(prev => ({ ...prev, ...state }));
    if (appendHistory && typeof state.lastmovesan === 'string') {
      setMoveHistory(prev => [...prev, state.lastmovesan]);
    }
    return true;
  }, []);

  const rollbackHistory = useCallback((count) => {
    setMoveHistory(prev => prev.slice(0, Math.max(0, prev.length - count)));
  }, []);

  const resign = useCallback((loserColor) => {
    setGameState(prev => ({
      ...prev,
      status: 'resignation',
      winner: loserColor === 'white' ? 'black' : 'white',
    }));
  }, []);

  // ── Callbacks: lifecycle ──
  const startNewGame = useCallback(async () => {
    setSessionError(null);
    setBusy(true);
    try {
      const engines = enginesRef.current;
      if (engines.length === 0) throw new Error('no engines bound to session');

      // Reset every instance. The server rotates the log game directory only
      // once all of them have reset.
      for (const e of engines) await e.newGame();

      const state = await engines[0].getGameState();
      if (!state || typeof state.fen !== 'string') {
        throw new Error(`gamestate response missing fen: ${JSON.stringify(state)}`);
      }
      if (!mountedRef.current) return false;

      setGameState({ ...INITIAL_GAME_STATE, ...state });
      setMoveHistory([]);
      setInitialized(true);
      return true;
    } catch (err) {
      reportFailure('useGameSession.startNewGame', err);
      if (mountedRef.current) setSessionError(err.message || 'Failed to start game');
      return false;
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  const retryInit = useCallback(async () => {
    initStartedRef.current = true;
    const ok = await startNewGame();
    if (!ok) initStartedRef.current = false;
  }, [startNewGame]);

  // ── Effects ──
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Auto-init once EVERY engine is up. Runs once per successful init.
  useEffect(() => {
    if (!allConnected || initStartedRef.current) return;
    initStartedRef.current = true;
    startNewGame().then(ok => { if (!ok) initStartedRef.current = false; });
  }, [allConnected, startNewGame]);

  // Watchdog: connected but no state after INIT_WATCHDOG → fail loud.
  useEffect(() => {
    if (!allConnected || initialized || sessionError !== null) return;
    const timer = setTimeout(() => {
      if (!mountedRef.current) return;
      const err = new Error(`No gamestate within ${TIMEOUTS.INIT_WATCHDOG}ms of connecting`);
      reportFailure('useGameSession.watchdog', err);
      setSessionError(err.message);
    }, TIMEOUTS.INIT_WATCHDOG);
    return () => clearTimeout(timer);
  }, [allConnected, initialized, sessionError]);

  // ── Return ──
  return {
    gameState, setGameState,
    moveHistory,
    initialized, busy, setBusy, sessionError,
    startNewGame, retryInit,
    applyEngineState, rollbackHistory, resign,
    mountedRef,
  };
}

export default useGameSession;