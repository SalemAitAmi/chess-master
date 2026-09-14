import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import EngineClient from '../engine/EngineClient';
import { reportFailure } from '../utils/failure';

// ═══════════════════════════════════════════════════════════════════════════
// Module state — a POOL of engine clients keyed by (url, session, instance).
//
// One client = one WebSocket = one engine instance on the server, with its own
// config and transposition table. Single-engine pages call useEngine() and get
// the default key; the Colosseum calls it twice with two instance names under
// one session id. Connections are kept open across page navigation and closed
// only by explicit reconnect() or by the browser on unload.
//
// Each slot owns a SET of listeners. The EngineClient callbacks are installed
// once, at slot creation, and fan out. Chaining onto the previous callback (the
// old pattern) grew without bound under StrictMode's double-invoke and left
// stale hooks wired to disposed clients.
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_SERVER_URL = 'ws://localhost:8080';
const DEFAULT_IDENTITY = { session: 'default', instance: 'e0', profile: 'baseline' };

/** key -> { key, engine, promise, listeners } */
const pool = new Map();

function keyOf(url, identity) {
  return `${url}|${identity.session}|${identity.instance}`;
}

function slotFor(url, identity) {
  const key = keyOf(url, identity);
  const existing = pool.get(key);
  if (existing !== undefined) return existing;

  const slot = { key, engine: new EngineClient(url, identity), promise: null, listeners: new Set() };
  const fan = (name) => (...args) => {
    for (const l of slot.listeners) {
      const h = l[name];
      if (h) h(...args);
    }
  };
  slot.engine.onInfo = fan('onInfo');
  slot.engine.onError = fan('onError');
  slot.engine.onConnectionChange = fan('onConnectionChange');
  pool.set(key, slot);
  return slot;
}

async function connectSlot(slot) {
  if (slot.engine.isConnected()) return true;
  if (slot.promise !== null) return slot.promise;
  slot.promise = (async () => {
    try {
      await slot.engine.connect();
      await slot.engine.initialize();
      // isConnected() is the only authority: `connect()` resolves on socket
      // open, but the engine is not usable until `uciok` has set `ready`.
      return slot.engine.isConnected();
    } catch (err) {
      reportFailure('useEngine.connectSlot', err);
      return false;
    } finally {
      slot.promise = null;
    }
  })();
  return slot.promise;
}

function disposeSlot(url, identity) {
  const key = keyOf(url, identity);
  const slot = pool.get(key);
  if (slot === undefined) return;
  try { slot.engine.disconnect(); }
  catch (e) { reportFailure('useEngine.disposeSlot', e); }
  slot.listeners.clear();
  pool.delete(key);
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook
//
// @param {string} serverUrl
// @param {{session?:string, instance?:string, profile?:string}|null} identity
//
// `connected` is TRUE ONLY when the engine is UCI-ready (uciok received). It is
// never derived from socket-open, because every method guard below uses
// isConnected(); reporting socket-open as connected opened a window in which
// callers saw `connected === true` and were then rejected with
// "Engine not connected".
// ═══════════════════════════════════════════════════════════════════════════

export function useEngine(serverUrl = DEFAULT_SERVER_URL, identity = null) {
  const session  = identity && identity.session  ? identity.session  : DEFAULT_IDENTITY.session;
  const instance = identity && identity.instance ? identity.instance : DEFAULT_IDENTITY.instance;
  const profile  = identity && identity.profile  ? identity.profile  : DEFAULT_IDENTITY.profile;
  const ident = useMemo(() => ({ session, instance, profile }), [session, instance, profile]);

  // ── State ──
  const [connected, setConnected] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [searchInfo, setSearchInfo] = useState(null);
  const [error, setError] = useState(null);
  // Bumped by reconnect() to force the effect to re-bind to the new slot.
  const [generation, setGeneration] = useState(0);

  // ── Refs ──
  const mountedRef = useRef(true);
  const engineRef = useRef(null);

  // ── Guard ──
  const requireEngine = useCallback(() => {
    const engine = engineRef.current;
    if (engine === null || !engine.isConnected()) {
      throw reportFailure(`useEngine[${instance}]`, new Error('Engine not connected'));
    }
    return engine;
  }, [instance]);

  // ── Standard UCI ──
  const newGame = useCallback(async () => {
    await requireEngine().newGame();
  }, [requireEngine]);

  const setPosition = useCallback(async (fen, moves = []) => {
    await requireEngine().setPosition(fen, moves);
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
    requireEngine().setOption(name, value);
  }, [requireEngine]);

  // ── Interactive extensions ──
  const validateMove  = useCallback(async (move) => requireEngine().validateMove(move), [requireEngine]);
  const getLegalMoves = useCallback(async (square = null) => requireEngine().getLegalMoves(square), [requireEngine]);
  const makeMove      = useCallback(async (move) => requireEngine().makeMove(move), [requireEngine]);
  const undoMove      = useCallback(async () => requireEngine().undoMove(), [requireEngine]);
  const getGameState  = useCallback(async () => requireEngine().getGameState(), [requireEngine]);
  const getProfiles   = useCallback(async () => requireEngine().getProfiles(), [requireEngine]);

  // ── Connection ──
  const reconnect = useCallback(async () => {
    disposeSlot(serverUrl, ident);
    if (mountedRef.current) {
      setConnected(false);
      setThinking(false);
      setError(null);
      setGeneration(g => g + 1);   // re-runs the effect against a fresh slot
    }
  }, [serverUrl, ident]);

  // ── Effects ──
  useEffect(() => {
    mountedRef.current = true;
    const slot = slotFor(serverUrl, ident);
    engineRef.current = slot.engine;

    /** Single source of truth for `connected`. */
    const sync = () => {
      if (!mountedRef.current) return false;
      const live = slot.engine.isConnected();
      setConnected(live);
      if (!live) setThinking(false);
      return live;
    };

    const listener = {
      onInfo: (info) => { if (mountedRef.current) setSearchInfo(info); },
      onError: (err) => {
        if (mountedRef.current) setError(err && err.message ? err.message : 'Engine error');
      },
      onConnectionChange: () => {
        const live = sync();
        if (!mountedRef.current) return;
        // The socket closing is an error; the socket merely not being ready yet
        // is not, so only report a loss once `ready` has been seen and dropped.
        if (live) setError(null);
        else if (slot.engine.ws === null || slot.engine.connected === false) {
          setError('Connection to engine lost');
        }
      },
    };
    slot.listeners.add(listener);
    sync();

    connectSlot(slot).then(success => {
      if (!mountedRef.current) return;
      sync();
      if (!success) setError('Failed to connect to engine server');
    });

    return () => {
      mountedRef.current = false;
      slot.listeners.delete(listener);
      // The WebSocket is intentionally left open across navigation.
    };
  }, [serverUrl, ident, generation]);

  // ── Return ──
  return useMemo(() => ({
    connected, thinking, searchInfo, error,
    session, instance, profile,
    newGame, setPosition, go, stop, setOption,
    validateMove, getLegalMoves, makeMove, undoMove, getGameState, getProfiles,
    reconnect,
  }), [
    connected, thinking, searchInfo, error,
    session, instance, profile,
    newGame, setPosition, go, stop, setOption,
    validateMove, getLegalMoves, makeMove, undoMove, getGameState, getProfiles,
    reconnect,
  ]);
}

export default useEngine;