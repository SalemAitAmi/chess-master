import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import EngineClient from '../engine/EngineClient';
import { reportFailure } from '../utils/failure';

// ═══════════════════════════════════════════════════════════════════════════
// Module state — singleton engine client shared across all components
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_SERVER_URL = 'ws://localhost:8080';

let sharedEngine = null;
let connectionPromise = null;
let listenerCount = 0;

// ═══════════════════════════════════════════════════════════════════════════
// Module helpers
// ═══════════════════════════════════════════════════════════════════════════

function getSharedEngine(serverUrl) {
  if (sharedEngine === null) sharedEngine = new EngineClient(serverUrl);
  return sharedEngine;
}

async function connectSharedEngine(engine) {
  if (engine.isConnected()) return true;
  if (connectionPromise !== null) return connectionPromise;

  connectionPromise = (async () => {
    try {
      await engine.connect();
      await engine.initialize();
      return true;
    } catch (err) {
      reportFailure('useEngine.connectSharedEngine', err);
      return false;
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook
//
// Every method REJECTS when the engine is not connected. Callers are expected
// to catch and surface the failure — nothing here returns a silent null.
// ═══════════════════════════════════════════════════════════════════════════
export function useEngine(serverUrl = DEFAULT_SERVER_URL) {
  // ── State ──
  const [connected, setConnected] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [searchInfo, setSearchInfo] = useState(null);
  const [error, setError] = useState(null);

  // ── Refs ──
  const mountedRef = useRef(true);
  const engineRef = useRef(null);

  // ── Callbacks: guard ──
  const requireEngine = useCallback(() => {
    const engine = engineRef.current;
    if (engine === null || !engine.isConnected()) {
      throw reportFailure('useEngine', new Error('Engine not connected'));
    }
    return engine;
  }, []);

  // ── Callbacks: standard UCI ──
  const newGame = useCallback(async () => {
    const engine = requireEngine();
    await engine.newGame();
  }, [requireEngine]);

  const setPosition = useCallback(async (fen, moves = []) => {
    const engine = requireEngine();
    await engine.setPosition(fen, moves);
  }, [requireEngine]);

  const go = useCallback(async (options = {}) => {
    const engine = requireEngine();
    setThinking(true);
    setSearchInfo(null);
    try {
      const result = await engine.go(options);
      if (!result || typeof result.move !== 'string') {
        throw new Error(`go returned no bestmove: ${JSON.stringify(result)}`);
      }
      return result;
    } finally {
      if (mountedRef.current) setThinking(false);
    }
  }, [requireEngine]);

  const stop = useCallback(() => {
    const engine = engineRef.current;
    if (engine !== null && engine.isConnected()) {
      try { engine.stop(); }
      catch (e) { reportFailure('useEngine.stop', e); }
    }
    setThinking(false);
  }, []);

  const setOption = useCallback((name, value) => {
    const engine = requireEngine();
    engine.setOption(name, value);
  }, [requireEngine]);

  // ── Callbacks: interactive extensions ──
  const validateMove = useCallback(async (move) => {
    const engine = requireEngine();
    return engine.validateMove(move);
  }, [requireEngine]);

  const getLegalMoves = useCallback(async (square = null) => {
    const engine = requireEngine();
    return engine.getLegalMoves(square);
  }, [requireEngine]);

  const makeMove = useCallback(async (move) => {
    const engine = requireEngine();
    return engine.makeMove(move);
  }, [requireEngine]);

  const undoMove = useCallback(async () => {
    const engine = requireEngine();
    return engine.undoMove();
  }, [requireEngine]);

  const getGameState = useCallback(async () => {
    const engine = requireEngine();
    return engine.getGameState();
  }, [requireEngine]);

  // ── Callbacks: connection ──
  const reconnect = useCallback(async () => {
    if (sharedEngine !== null) {
      try { sharedEngine.disconnect(); }
      catch (e) { reportFailure('useEngine.reconnect.disconnect', e); }
      sharedEngine = null;
    }
    connectionPromise = null;

    const engine = getSharedEngine(serverUrl);
    engineRef.current = engine;
    engine.onConnectionChange = (isConnected) => {
      if (!mountedRef.current) return;
      setConnected(isConnected);
      if (!isConnected) setThinking(false);
    };

    setError(null);
    let success = false;
    try {
      success = await connectSharedEngine(engine);
    } catch (err) {
      reportFailure('useEngine.reconnect', err);
    }
    if (!mountedRef.current) return;
    setConnected(success);
    if (!success) setError('Failed to reconnect to engine server');
  }, [serverUrl]);

  // ── Effects ──
  useEffect(() => {
    mountedRef.current = true;
    listenerCount++;

    const engine = getSharedEngine(serverUrl);
    engineRef.current = engine;

    const prevOnInfo = engine.onInfo;
    const prevOnConnectionChange = engine.onConnectionChange;
    const prevOnError = engine.onError;

    engine.onInfo = (info) => {
      if (mountedRef.current) setSearchInfo(info);
      if (prevOnInfo) prevOnInfo(info);
    };

    engine.onConnectionChange = (isConnected) => {
      if (mountedRef.current) {
        setConnected(isConnected);
        if (!isConnected) {
          setThinking(false);
          setError('Connection to engine lost');
        } else {
          setError(null);
        }
      }
      if (prevOnConnectionChange) prevOnConnectionChange(isConnected);
    };

    engine.onError = (err) => {
      if (mountedRef.current) setError(err && err.message ? err.message : 'Engine error');
      if (prevOnError) prevOnError(err);
    };

    connectSharedEngine(engine).then(success => {
      if (!mountedRef.current) return;
      setConnected(success);
      if (!success) setError('Failed to connect to engine server');
    });

    if (engine.isConnected()) setConnected(true);

    return () => {
      mountedRef.current = false;
      listenerCount--;
      // The WebSocket is intentionally kept open across page navigation —
      // reconnecting on every route change costs ~1s and drops engine state.
      // It is closed only by explicit reconnect() or by the browser on unload.
    };
  }, [serverUrl]);

  // ── Return ──
  return useMemo(() => ({
    connected, thinking, searchInfo, error,
    newGame, setPosition, go, stop, setOption,
    validateMove, getLegalMoves, makeMove, undoMove, getGameState,
    reconnect,
  }), [
    connected, thinking, searchInfo, error,
    newGame, setPosition, go, stop, setOption,
    validateMove, getLegalMoves, makeMove, undoMove, getGameState,
    reconnect,
  ]);
}

export default useEngine;