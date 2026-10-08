/**
 * UCI engine client. ONE CLIENT = ONE SOCKET = ONE ENGINE INSTANCE.
 *
 *   open → `session <sid> <inst> <profile>`   (→ session ok|error)
 *        → `uci`                              (→ option/profile lines → catalog; uciok)
 *        → `setoptions <delta>` if non-empty  (→ optionsok|optionserror)
 * While connected the client is subscribed to settings: a local commit syncs
 * only the delta. `applied` mirrors what the instance runs.
 *
 * Wire access is serialized through `_enqueue`, so each response slot is
 * occupied by at most one request, by construction.
 */
import { ingestUciLine, profileValues, getOption, parseWire, toWire } from '../config/catalog';
import { getSettings, subscribe, desiredFor, batchFor } from '../config/settings';
const DEFAULT_SERVER_URL = 'ws://localhost:8080';
const CONNECT_TIMEOUT_MS = 5000;
const COMMAND_TIMEOUT_MS = 10000;
const SEARCH_TIMEOUT_MS = 660000;
const SLOTS = ['pendingSimpleResponse', 'pendingSearchResponse', 'pendingMultiLineResponse'];
const BOOL_KEYS = ['incheck', 'canundo', 'blunder'];
const INT_KEYS = ['fullmove', 'halfmove', 'legalmovecount', 'eval', 'material_white',
                  'material_black', 'material_diff', 'movecount', 'repetitions'];
export class EngineClient {
  constructor(serverUrl = DEFAULT_SERVER_URL, opts = {}) {
    this.serverUrl = serverUrl;
    this.ws = null;
    this.connected = false;
    this.handshakeComplete = false;
    this.session = opts.session || 'default';
    this.instance = opts.instance || 'e0';
    this.role = opts.role || (this.instance === 'e0' ? 'primary' : 'contestant');
    this.fixedProfile = opts.profile || null;   // contestants: from the menu; primary: from settings
    this.applied = null;                        // { profile, values }
    this.cfgHash = null;
    this.sessionError = null;
    this._unsubscribe = null;
    for (const s of SLOTS) this[s] = null;
    this._chain = Promise.resolve();
    this.onConnectionChange = null;
    this.onError = null;
  }
  get label() { return `${this.session}/${this.instance}`; }
  get profile() { return this.fixedProfile ?? getSettings().profile; }
  // ═══════════ Connection ═══════════
  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => { if (settled) return; settled = true; err ? reject(err) : resolve(); };
      try { this.ws = new WebSocket(this.serverUrl); } catch (err) { done(err); return; }
      this.ws.onopen = () => {
        this.connected = true;
        this.ws.send(`session ${this.session} ${this.instance} ${this.profile}`);
        done();
      };
      this.ws.onmessage = (e) => this.handleMessage(e.data);
      this.ws.onerror = (err) => {
        if (this.onError) this.onError(err);
        if (!this.connected) done(new Error('Failed to connect to engine server'));
      };
      this.ws.onclose = () => {
        const wasUsable = this.isConnected();
        this._reset(new Error('Connection closed'));
        if (wasUsable && this.onConnectionChange) this.onConnectionChange(false);
        done(new Error('Connection closed before open'));
      };
      setTimeout(() => { if (!this.connected) { if (this.ws) this.ws.close(); done(new Error('Connection timeout')); } },
                 CONNECT_TIMEOUT_MS);
    });
  }
  async initialize() {
    await this._enqueue(async () => {
      await this._request('pendingSimpleResponse', 'uci', COMMAND_TIMEOUT_MS);
      if (this.sessionError !== null) throw new Error(`session rejected: ${this.sessionError}`);
      // A fresh instance runs its handshake profile exactly.
      if (this.applied === null) this.applied = { profile: this.profile, values: null };
      this.applied.values = profileValues(this.applied.profile);
    });
    const sync = await this.syncConfig();
    if (!sync.ok) console.warn(`[${this.label}] initial config sync failed: ${sync.error}`);
    this.handshakeComplete = true;
    if (this._unsubscribe === null) this._unsubscribe = subscribe((s) => this.syncConfig(s));
    if (this.onConnectionChange) this.onConnectionChange(true);
  }
  disconnect() {
    if (!this.ws) return;
    const ws = this.ws;
    this._reset(new Error(`[${this.label}] client disconnecting`));
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try { if (ws.readyState === WebSocket.OPEN) ws.send('quit'); ws.close(1000, 'client teardown'); } catch { /* */ }
  }
  _reset(err) {
    for (const s of SLOTS) { const p = this[s]; if (p) { this[s] = null; p.reject(err); } }
    if (this._unsubscribe !== null) { this._unsubscribe(); this._unsubscribe = null; }
    this.ws = null;
    this.connected = false;
    this.handshakeComplete = false;
    this.applied = null;
    this.cfgHash = null;
    this.sessionError = null;
    this._chain = Promise.resolve();
  }
  isConnected() {
    return this.connected && this.handshakeComplete && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
  // ═══════════ Config sync — deltas only ═══════════
  /** @returns {Promise<{engine, ok, changes?, hash?, clamped?, error?}>} */
  async syncConfig(settings = getSettings()) {
    const engine = this.label;
    if (this.applied === null) return { engine, ok: false, error: 'not initialized' };
    const { entries, profile, reset } = batchFor(this.applied, desiredFor(settings, this.role));
    if (entries.length === 0) return { engine, ok: true, changes: 0, hash: this.cfgHash };
    let ack;
    try {
      ack = await this.sendAndWait('setoptions ' + entries.map(([k, v]) => `${k}=${toWire(v)}`).join(' '));
    } catch (err) {
      this.applied.values = null;          // state unknown → next sync reloads the profile
      return { engine, ok: false, error: err.message };
    }
    if (!ack.ok) return { engine, ok: false, error: `${ack.name}: ${ack.reason}` };  // atomic: nothing changed
    if (reset) this.applied = { profile, values: profileValues(profile) };
    const clamped = [];
    for (const [k, v] of entries) {
      if (k === 'Profile') continue;
      const o = getOption(k);
      const eff = ack.effective.get(k);
      const value = eff !== undefined && o !== null ? parseWire(o, eff) : v;
      this.applied.values[k] = value;
      if (value !== v) clamped.push(`${k}=${eff}`);
    }
    this.cfgHash = ack.hash;
    return { engine, ok: true, changes: entries.length, hash: ack.hash, clamped };
  }
  // ═══════════ Inbound ═══════════
  handleMessage(data) {
    const lines = String(data).split('\n');
    if (this.pendingMultiLineResponse !== null && isGameStateMessage(lines)) {
      const p = this.pendingMultiLineResponse;
      this.pendingMultiLineResponse = null;
      try { p.resolve(parseGameState(lines)); } catch (err) { p.reject(err); }
      return;
    }
    for (const line of lines) if (line.trim()) this._routeLine(line);
  }
  _routeLine(line) {
    if (ingestUciLine(line)) return;
    if (line.startsWith('session ')) {
      const t = line.split(' ');
      if (t[1] === 'ok') { this.instance = t[3]; this.applied = { profile: t[4], values: null }; this.cfgHash = t[5] ?? null; }
      else this.sessionError = t.slice(2).join(' ') || 'unknown';
      return;
    }
    if (line === 'uciok' || line === 'readyok') { this._resolveSimple(undefined); return; }
    if (line.startsWith('optionsok ')) {
      const [, hash, ...kv] = line.split(' ');
      const effective = new Map();
      for (const pair of kv) { const i = pair.indexOf('='); if (i > 0) effective.set(pair.slice(0, i), pair.slice(i + 1)); }
      this._resolveSimple({ ok: true, hash, effective });
      return;
    }
    if (line.startsWith('optionserror ')) {
      const [, name, ...why] = line.split(' ');
      this._resolveSimple({ ok: false, name, reason: why.join(' ') });
      return;
    }
    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const p = this.pendingSearchResponse;
      if (p) { this.pendingSearchResponse = null; p.resolve({ move: parts[1], ponder: parts[3] ?? null }); }
      return;
    }
    if (line.startsWith('valid ')) {
      const parts = line.split(' ');
      this._resolveSimple({ valid: parts[1] === 'true', reason: parts[2] ?? null });
      return;
    }
    if (line.startsWith('legalmoves ')) {
      const c = line.slice('legalmoves '.length);
      this._resolveSimple(c.startsWith('none') ? { moves: [], error: c.split(' ')[1] ?? null } : { moves: c.split(' '), error: null });
      return;
    }
    if (line.startsWith('fenvalid ')) {
      const [, ok, ...why] = line.split(' ');
      this._resolveSimple({ valid: ok === 'true', reason: why.length ? why.join(' ') : null });
      return;
    }
    if (line.startsWith('eval ')) { this._resolveSimple({ eval: parseInt(line.split(' ')[1], 10) }); return; }
    if (line.startsWith('error ')) {
      const p = this.pendingSimpleResponse;
      if (p) { this.pendingSimpleResponse = null; p.reject(new Error(line.slice(6))); }
    }
    // `info …` lines are informational only.
  }
  _resolveSimple(value) {
    const p = this.pendingSimpleResponse;
    if (p) { this.pendingSimpleResponse = null; p.resolve(value); }
  }
  // ═══════════ Outbound ═══════════
  send(command) {
    if (!this.connected || this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`[${this.label}] not connected to engine`);
    }
    this.ws.send(command);
  }
  _enqueue(task) {
    const run = this._chain.then(task, task);
    this._chain = run.then(() => {}, () => {});
    return run;
  }
  _request(slot, command, timeout) {
    return new Promise((resolve, reject) => {
      if (this[slot] !== null) { reject(new Error(`[${this.label}] INVARIANT: ${slot} busy for "${command}"`)); return; }
      const timer = setTimeout(() => { this[slot] = null; reject(new Error(`[${this.label}] timeout after ${timeout}ms: ${command}`)); }, timeout);
      this[slot] = {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
      try { this.send(command); } catch (err) { clearTimeout(timer); this[slot] = null; reject(err); }
    });
  }
  sendAndWait(cmd, timeout = COMMAND_TIMEOUT_MS) { return this._enqueue(() => this._request('pendingSimpleResponse', cmd, timeout)); }
  sendQueued(cmd) { return this._enqueue(() => { this.send(cmd); }); }
  // ═══════════ Commands ═══════════
  newGame() {
    return this._enqueue(async () => {
      this.send('ucinewgame');
      await this._request('pendingSimpleResponse', 'isready', COMMAND_TIMEOUT_MS);
    });
  }
  setPosition(fen = null, moves = []) {
    return this.sendQueued((fen ? `position fen ${fen}` : 'position startpos') + (moves.length ? ` moves ${moves.join(' ')}` : ''));
  }
  go({ depth, movetime } = {}) {
    const cmd = 'go' + (depth ? ` depth ${depth}` : '') + (movetime ? ` movetime ${movetime}` : '');
    return this._enqueue(() => this._request('pendingSearchResponse', cmd, SEARCH_TIMEOUT_MS));
  }
  /** Bypasses the queue on purpose: it must interrupt the task holding the wire. */
  stop() { try { if (this.connected) this.send('stop'); } catch { /* */ } }
  validateMove(m) { return this.sendAndWait(`validate ${m}`); }
  getLegalMoves(sq = null) { return this.sendAndWait(sq ? `legalmoves ${sq}` : 'legalmoves'); }
  validateFen(fen) { return this.sendAndWait(`validatefen ${fen}`); }
  makeMove(m) { return this._enqueue(() => this._request('pendingMultiLineResponse', `makemove ${m}`, COMMAND_TIMEOUT_MS)); }
  undoMove() { return this._enqueue(() => this._request('pendingMultiLineResponse', 'undomove', COMMAND_TIMEOUT_MS)); }
  getGameState() { return this._enqueue(() => this._request('pendingMultiLineResponse', 'gamestate', COMMAND_TIMEOUT_MS)); }
}
function isGameStateMessage(lines) {
  const first = lines.find(l => l.trim());
  if (!first) return false;
  if (first.startsWith('error ') || first.startsWith('valid false')) return true;
  return lines.some(l => l.startsWith('fen '));
}
function parseGameState(lines) {
  const first = lines.find(l => l.trim());
  if (first.startsWith('error ') || first.startsWith('valid false')) throw new Error(first);
  const r = {};
  for (const line of lines) {
    const i = line.indexOf(' ');
    if (i === -1) continue;
    const k = line.slice(0, i), v = line.slice(i + 1);
    if (BOOL_KEYS.includes(k)) r[k] = v === 'true';
    else if (INT_KEYS.includes(k)) r[k] = parseInt(v, 10) || 0;
    else if (k === 'captured_white' || k === 'captured_black') r[k] = v === 'none' ? [] : v.split('');
    else if (k === 'history' || k === 'historyuci') r[k] = v === 'none' ? [] : v.split(' ');
    else r[k] = v;
  }
  if (typeof r.fen !== 'string') throw new Error(`gamestate block missing fen: ${lines.slice(0, 2).join(' | ')}`);
  return r;
}
export default EngineClient;