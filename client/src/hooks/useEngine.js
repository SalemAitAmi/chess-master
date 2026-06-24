import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import EngineClient from '../engine/EngineClient';

export const LOG_CATEGORY = {
  NONE: 0,
  SEARCH: 1 << 0,
  EVAL: 1 << 1,
  MOVE_ORDER: 1 << 2,
  TT: 1 << 3,
  UCI: 1 << 4,
  BOOK: 1 << 5,
  ALL: 0x3FF
};

// Singleton engine client - shared across all components
let sharedEngine = null;
let connectionPromise = null;
let listenerCount = 0;

function getSharedEngine(serverUrl) {
  if (!sharedEngine) {
    sharedEngine = new EngineClient(serverUrl);
  }
  return sharedEngine;
}

async function connectSharedEngine(engine) {
  if (engine.isConnected()) {
    return true;
  }
  
  if (connectionPromise) {
    return connectionPromise;
  }
  
  connectionPromise = (async () => {
    try {
      await engine.connect();
      await engine.initialize();
      return true;
    } catch (err) {
      console.error('Engine connection failed:', err);
      return false;
    } finally {
      connectionPromise = null;
    }
  })();
  
  return connectionPromise;
}

export function useEngine(serverUrl = 'ws://localhost:8080') {
  const [connected, setConnected] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [searchInfo, setSearchInfo] = useState(null);
  const [error, setError] = useState(null);
  
  const mountedRef = useRef(true);
  const engineRef = useRef(null);

  // Initialize and connect
  useEffect(() => {
    mountedRef.current = true;
    listenerCount++;
    
    const engine = getSharedEngine(serverUrl);
    engineRef.current = engine;

    // Set up callbacks
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
      if (mountedRef.current) {
        setError(err.message || 'Engine error');
      }
      if (prevOnError) prevOnError(err);
    };

    // Connect
    connectSharedEngine(engine).then(success => {
      if (mountedRef.current) {
        setConnected(success);
        if (!success) {
          setError('Failed to connect to engine server');
        }
      }
    });

    // Update state if already connected
    if (engine.isConnected()) {
      setConnected(true);
    }

    return () => {
      mountedRef.current = false;
      listenerCount--;
      
      // Only disconnect if no more listeners AND we're actually connected
      // Don't disconnect on page navigation - keep connection alive
      if (listenerCount === 0 && sharedEngine?.isConnected()) {
        // Keep connection alive for now - only close on app unmount
        // This prevents reconnection delays when navigating between pages
      }
    };
  }, [serverUrl]);

  // Stable method references
  const newGame = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine?.isConnected()) return;
    try {
      await engine.newGame();
    } catch (err) {
      console.error('Failed to start new game:', err);
    }
  }, []);

  const setPosition = useCallback(async (fen, moves = []) => {
    const engine = engineRef.current;
    if (!engine?.isConnected()) return;
    try {
      await engine.setPosition(fen, moves);
    } catch (err) {
      console.error('Failed to set position:', err);
    }
  }, []);

  const go = useCallback(async (options = {}) => {
    const engine = engineRef.current;
    if (!engine?.isConnected()) {
      throw new Error('Engine not connected');
    }
    
    setThinking(true);
    setSearchInfo(null);

    try {
      const result = await engine.go(options);
      return result;
    } finally {
      if (mountedRef.current) setThinking(false);
    }
  }, []);

  const stop = useCallback(() => {
    const engine = engineRef.current;
    if (engine?.isConnected()) {
      try {
        engine.stop();
      } catch (e) {
        console.warn('Failed to stop:', e);
      }
    }
    setThinking(false);
  }, []);

  const validateMove = useCallback(async (move) => {
    const engine = engineRef.current;
    if (!engine?.isConnected()) return { valid: false, reason: 'not_connected' };
    try {
      return await engine.validateMove(move);
    } catch (err) {
      return { valid: false, reason: err.message };
    }
  }, []);

  const getLegalMoves = useCallback(async (square = null) => {
    const engine = engineRef.current;
    if (!engine?.isConnected()) return { moves: [], error: 'not_connected' };
    try {
      return await engine.getLegalMoves(square);
    } catch (err) {
      return { moves: [], error: err.message };
    }
  }, []);

  const makeMove = useCallback(async (move) => {
    const engine = engineRef.current;
    if (!engine?.isConnected()) return null;
    try {
      return await engine.makeMove(move);
    } catch (err) {
      console.error('makeMove failed:', err);
      return null;
    }
  }, []);

  const undoMove = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine?.isConnected()) return null;
    try {
      return await engine.undoMove();
    } catch (err) {
      console.error('undoMove failed:', err);
      return null;
    }
  }, []);

  const getGameState = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine?.isConnected()) return null;
    try {
      return await engine.getGameState();
    } catch (err) {
      console.error('getGameState failed:', err);
      return null;
    }
  }, []);

  const reconnect = useCallback(async () => {
    // Force new connection
    if (sharedEngine) {
      try {
        sharedEngine.disconnect();
      } catch (e) {
        // ignore
      }
      sharedEngine = null;
    }
    connectionPromise = null;
    
    const engine = getSharedEngine(serverUrl);
    engineRef.current = engine;
    
    engine.onConnectionChange = (isConnected) => {
      if (mountedRef.current) {
        setConnected(isConnected);
        if (!isConnected) setThinking(false);
      }
    };

    try {
      setError(null);
      const success = await connectSharedEngine(engine);
      setConnected(success);
      if (!success) {
        setError('Failed to reconnect');
      }
    } catch (err) {
      setError('Failed to reconnect: ' + err.message);
      setConnected(false);
    }
  }, [serverUrl]);

  // Return a stable object using useMemo
  return useMemo(() => ({
    connected,
    thinking,
    searchInfo,
    error,
    newGame,
    setPosition,
    go,
    stop,
    validateMove,
    getLegalMoves,
    makeMove,
    undoMove,
    getGameState,
    reconnect,
  }), [
    connected, thinking, searchInfo, error,
    newGame, setPosition, go, stop,
    validateMove, getLegalMoves, makeMove, undoMove, getGameState, reconnect
  ]);
}

export default useEngine;