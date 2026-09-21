import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import EngineClient from '../engine/EngineClient';
import { reportFailure } from '../utils/failure';

// ═══════════════════════════════════════════════════════════════════════════
// Module state — a POOL of engine clients keyed by (url, session, instance).
//
// One client = one WebSocket = one engine instance on the server, with its own
// config and transposition table. Single-engine pages call useEngine() and get
// the default key; the Colosseum calls it twice with two instance names under
// one session id.
//
// `connected` is TRUE ONLY when the engine's UCI handshake has COMPLETED (see
// EngineClient.handshakeComplete). Reporting socket-open — or even `uciok` —
// as connected is what allowed a second client's render to interleave a
// `ucinewgame` into the first client's handshake.
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
  const [profiles, setProfiles] = useState([]);
  const [options, setOptions] = useState(null);
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
  const newGame = useCallback(async () => { await requireEngine().newGame(); }, [requireEngine]);

  const setPosition = useCallback(async (fen, moves = []) => {
    await requireEngine().setPosition(fen, moves);
  }, [requireEngine]);

  const go = useCallback(async (opts = {}) => {
    const engine = requireEngine();
    setThinking(true);
    setSearchInfo(null);
    try {
      const result = await engine.go(opts);
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
      try { engine.stop(); } catch (e) { reportFailure('useEngine.stop', e); }
    }
    setThinking(false);
  }, []);

  const setOption = useCallback((name, value) => { requireEngine().setOption(name, value); }, [requireEngine]);

  // ── Interactive extensions ──
  const validateMove  = useCallback(async (m) => requireEngine().validateMove(m), [requireEngine]);
  const getLegalMoves = useCallback(async (sq = null) => requireEngine().getLegalMoves(sq), [requireEngine]);
  const makeMove      = useCallback(async (m) => requireEngine().makeMove(m), [requireEngine]);
  const undoMove      = useCallback(async () => requireEngine().undoMove(), [requireEngine]);
  const getGameState  = useCallback(async () => requireEngine().getGameState(), [requireEngine]);

  // ── Connection ──
  const reconnect = useCallback(async () => {
    disposeSlot(serverUrl, ident);
    if (mountedRef.current) {
      setConnected(false);
      setThinking(false);
      setError(null);
      setGeneration(g => g + 1);
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
      if (live) {
        setProfiles(slot.engine.availableProfiles);
        setOptions(slot.engine.availableOptions);
      }
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
    connected, thinking, searchInfo, error, profiles, options,
    session, instance, profile,
    newGame, setPosition, go, stop, setOption,
    validateMove, getLegalMoves, makeMove, undoMove, getGameState,
    reconnect,
  }), [
    connected, thinking, searchInfo, error, profiles, options,
    session, instance, profile,
    newGame, setPosition, go, stop, setOption,
    validateMove, getLegalMoves, makeMove, undoMove, getGameState,
    reconnect,
  ]);
}

/**
 * Tear down EVERY pooled connection. The pool deliberately outlives page
 * navigation, so it needs an explicit end-of-life hook: `pagehide` (the only
 * event that fires reliably on mobile/back-forward cache) and `beforeunload`.
 *
 * Each disconnect rejects that client's pending slots, which unwinds any
 * awaiting move loop instead of leaving it parked until the server notices.
 */
export function disposeAllEngines(reason = 'page teardown') {
  for (const [key, slot] of pool) {
    try { slot.engine.disconnect(); }
    catch (e) { reportFailure(`useEngine.disposeAllEngines(${key})`, e); }
    slot.listeners.clear();
    pool.delete(key);
  }
  if (typeof console !== 'undefined') console.log(`[useEngine] pool disposed: ${reason}`);
}

if (typeof window !== 'undefined') {
  const teardown = () => disposeAllEngines('pagehide/beforeunload');
  window.addEventListener('pagehide', teardown);
  window.addEventListener('beforeunload', teardown);
  // CRA hot-reload replaces this module without reloading the page; without
  // this, every edit leaked a socket and the engine accumulated orphan
  // instances in instances.ndjson.
  if (typeof module !== 'undefined' && module.hot) {
    module.hot.dispose(() => disposeAllEngines('hot reload'));
  }
}

export default useEngine;