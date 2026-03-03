import { useState, useEffect, useRef, useCallback } from 'react';
import EngineClient, { LOG_CATEGORY } from '../engine/EngineClient';

export function useEngine(serverUrl = 'ws://localhost:8080') {
  const [connected, setConnected] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [searchInfo, setSearchInfo] = useState(null);
  const [error, setError] = useState(null);
  const engineRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const engine = new EngineClient(serverUrl);
    engineRef.current = engine;

    engine.onInfo = (info) => {
      if (mountedRef.current) {
        setSearchInfo(info);
      }
    };

    engine.onConnectionChange = (isConnected) => {
      console.log('Connection state changed:', isConnected);
      if (mountedRef.current) {
        setConnected(isConnected);
        if (!isConnected) {
          setThinking(false);
          setError('Connection to engine lost');
        }
      }
    };

    engine.onError = (err) => {
      console.error('Engine error:', err);
      if (mountedRef.current) {
        setError(err.message || 'Engine error');
      }
    };

    const connect = async () => {
      try {
        setError(null);
        await engine.connect();
        await engine.initialize();

        if (mountedRef.current) {
          try {
            engine.setLogMask(LOG_CATEGORY.SEARCH | LOG_CATEGORY.EVAL | LOG_CATEGORY.BOOK);
          } catch (e) {
            console.warn('Failed to set log mask:', e);
          }

          setConnected(true);
          setError(null);
        }
      } catch (err) {
        console.error('Failed to connect to engine:', err);
        if (mountedRef.current) {
          setError('Failed to connect to engine server. Make sure the server is running on ' + serverUrl);
          setConnected(false);
        }
      }
    };

    connect();

    return () => {
      mountedRef.current = false;
      if (engine.isConnected()) {
        engine.disconnect();
      }
    };
  }, [serverUrl]);

  const newGame = useCallback(async () => {
    if (!engineRef.current?.isConnected()) {
      console.warn('Cannot start new game: engine not connected');
      return;
    }

    try {
      await engineRef.current.newGame();
    } catch (err) {
      console.error('Failed to start new game:', err);
      setError('Failed to start new game');
    }
  }, []);

  const setPosition = useCallback(async (fen, moves = []) => {
    if (!engineRef.current?.isConnected()) {
      console.warn('Cannot set position: engine not connected');
      return;
    }

    try {
      await engineRef.current.setPosition(fen, moves);
    } catch (err) {
      console.error('Failed to set position:', err);
    }
  }, []);

  const findBestMove = useCallback(async (fen, options = {}) => {
    if (!engineRef.current?.isConnected()) {
      throw new Error('Engine not connected');
    }

    // Prevent multiple simultaneous searches
    if (thinking) {
      console.warn('Already searching, ignoring request');
      return null;
    }

    setThinking(true);
    setSearchInfo(null);

    try {
      await engineRef.current.setPosition(fen);
      const result = await engineRef.current.go(options);
      return result;
    } catch (err) {
      console.error('Find best move error:', err);
      throw err;
    } finally {
      if (mountedRef.current) {
        setThinking(false);
      }
    }
  }, [thinking]);

  const stop = useCallback(() => {
    if (engineRef.current?.isConnected()) {
      try {
        engineRef.current.stop();
      } catch (e) {
        console.warn('Failed to stop engine:', e);
      }
    }
    setThinking(false);
  }, []);

  const setOption = useCallback((name, value) => {
    if (engineRef.current?.isConnected()) {
      try {
        engineRef.current.setOption(name, value);
      } catch (e) {
        console.warn('Failed to set option:', e);
      }
    }
  }, []);

  const setLogCategories = useCallback((mask) => {
    if (engineRef.current?.isConnected()) {
      try {
        engineRef.current.setLogMask(mask);
      } catch (e) {
        console.warn('Failed to set log categories:', e);
      }
    }
  }, []);

  const reconnect = useCallback(async () => {
    if (engineRef.current) {
      engineRef.current.disconnect();
    }

    const engine = new EngineClient(serverUrl);
    engineRef.current = engine;

    engine.onInfo = (info) => {
      if (mountedRef.current) {
        setSearchInfo(info);
      }
    };

    engine.onConnectionChange = (isConnected) => {
      if (mountedRef.current) {
        setConnected(isConnected);
        if (!isConnected) {
          setThinking(false);
        }
      }
    };

    try {
      setError(null);
      await engine.connect();
      await engine.initialize();
      setConnected(true);
    } catch (err) {
      setError('Failed to reconnect: ' + err.message);
      setConnected(false);
    }
  }, [serverUrl]);

  return {
    connected,
    thinking,
    searchInfo,
    error,
    newGame,
    setPosition,
    findBestMove,
    stop,
    setOption,
    setLogCategories,
    reconnect,
    LOG_CATEGORY
  };
}

export { LOG_CATEGORY };
export default useEngine;