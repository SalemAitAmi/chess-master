import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import EngineClient from '../engine/EngineClient';
import { reportFailure } from '../utils/failure';
/**
 * Pool of engine clients keyed by (url, session, instance). e0 ('primary') is
 * opened by the app shell; A and B ('contestant') by the Colosseum. Config sync
 * lives in EngineClient, so no component pushes settings.
 */
const DEFAULT_SERVER_URL = 'ws://localhost:8080';
const pool = new Map();
const keyOf = (url, id) => `${url}|${id.session}|${id.instance}`;
function slotFor(url, id) {
  const key = keyOf(url, id);
  let slot = pool.get(key);
  if (slot) return slot;
  slot = { key, engine: new EngineClient(url, id), promise: null, listeners: new Set() };
  slot.engine.onConnectionChange = (live) => { for (const l of slot.listeners) l(live); };
  pool.set(key, slot);
  return slot;
}
function connectSlot(slot) {
  if (slot.engine.isConnected()) return Promise.resolve(true);
  if (slot.promise === null) {
    slot.promise = (async () => {
      try { await slot.engine.connect(); await slot.engine.initialize(); return slot.engine.isConnected(); }
      catch (err) { reportFailure('useEngine.connect', err); return false; }
      finally { slot.promise = null; }
    })();
  }
  return slot.promise;
}
function disposeSlot(url, id) {
  const slot = pool.get(keyOf(url, id));
  if (!slot) return;
  try { slot.engine.disconnect(); } catch (e) { reportFailure('useEngine.dispose', e); }
  slot.listeners.clear();
  pool.delete(slot.key);
}
export function useEngine(serverUrl = DEFAULT_SERVER_URL, identity = null) {
  const session = identity?.session ?? 'default';
  const instance = identity?.instance ?? 'e0';
  const profile = identity?.profile ?? null;
  const role = identity?.role ?? (instance === 'e0' ? 'primary' : 'contestant');
  const ident = useMemo(() => ({ session, instance, profile, role }), [session, instance, profile, role]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [generation, setGeneration] = useState(0);
  const mountedRef = useRef(true);
  const engineRef = useRef(null);
  const requireEngine = useCallback(() => {
    const e = engineRef.current;
    if (e === null || !e.isConnected()) throw reportFailure(`useEngine[${instance}]`, new Error('Engine not connected'));
    return e;
  }, [instance]);
  const newGame       = useCallback(() => requireEngine().newGame(), [requireEngine]);
  const setPosition   = useCallback((fen, moves = []) => requireEngine().setPosition(fen, moves), [requireEngine]);
  const validateMove  = useCallback((m) => requireEngine().validateMove(m), [requireEngine]);
  const getLegalMoves = useCallback((sq = null) => requireEngine().getLegalMoves(sq), [requireEngine]);
  const makeMove      = useCallback((m) => requireEngine().makeMove(m), [requireEngine]);
  const undoMove      = useCallback(() => requireEngine().undoMove(), [requireEngine]);
  const getGameState  = useCallback(() => requireEngine().getGameState(), [requireEngine]);
  const validateFen   = useCallback((f) => requireEngine().validateFen(f), [requireEngine]);
  const go = useCallback(async (opts = {}) => {
    const result = await requireEngine().go(opts);
    if (!result || typeof result.move !== 'string') throw new Error(`go returned no bestmove: ${JSON.stringify(result)}`);
    return result;
  }, [requireEngine]);
  const stop = useCallback(() => { if (engineRef.current) engineRef.current.stop(); }, []);
  const reconnect = useCallback(() => {
    disposeSlot(serverUrl, ident);
    if (mountedRef.current) { setConnected(false); setError(null); setGeneration(g => g + 1); }
  }, [serverUrl, ident]);
  useEffect(() => {
    mountedRef.current = true;
    const slot = slotFor(serverUrl, ident);
    engineRef.current = slot.engine;
    const listener = (live) => {
      if (!mountedRef.current) return;
      setConnected(live);
      setError(live ? null : 'Connection to engine lost');
    };
    slot.listeners.add(listener);
    setConnected(slot.engine.isConnected());
    connectSlot(slot).then(ok => {
      if (!mountedRef.current) return;
      setConnected(slot.engine.isConnected());
      if (!ok) setError('Failed to connect to engine server');
    });
    return () => { mountedRef.current = false; slot.listeners.delete(listener); };
  }, [serverUrl, ident, generation]);
  return useMemo(() => ({
    connected, error, session, instance, role,
    newGame, setPosition, go, stop, validateMove, getLegalMoves, makeMove, undoMove,
    getGameState, validateFen, reconnect,
  }), [connected, error, session, instance, role, newGame, setPosition, go, stop, validateMove,
      getLegalMoves, makeMove, undoMove, getGameState, validateFen, reconnect]);
}
export function disposeAllEngines(reason = 'page teardown') {
  for (const [key, slot] of pool) {
    try { slot.engine.disconnect(); } catch (e) { reportFailure(`useEngine.disposeAll(${key})`, e); }
    slot.listeners.clear();
    pool.delete(key);
  }
  console.log(`[useEngine] pool disposed: ${reason}`);
}
if (typeof window !== 'undefined') {
  const teardown = () => disposeAllEngines('pagehide/beforeunload');
  window.addEventListener('pagehide', teardown);
  window.addEventListener('beforeunload', teardown);
  if (typeof module !== 'undefined' && module.hot) module.hot.dispose(() => disposeAllEngines('hot reload'));
}
export default useEngine;