/**
 * Engine logger — timestamped file output with periodic flush and crash guard.
 *
 * Changes from previous version:
 *   - Single timestamped log file per session (e.g. 2025-01-15T12-30-00.log)
 *   - All output routed to the file, NOT stdout
 *   - Periodic flush (every 5 s) via setInterval
 *   - flushSync() for crash/exit handlers
 *   - Turn NDJSON stream still goes to a separate per-game file
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LOG_CATEGORY, CATEGORY_NAMES, GAME_STAGE } from './categories.js';

const __DEV__ = globalThis.__DEV__ ?? true;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '../../logs');
const TURN_LOG_DIR = path.join(LOG_DIR, 'turns');


// ── Hot-path guard flags ──
export const LOG = {
  search:false, eval:false, moveOrder:false, tt:false, uci:false,
  book:false, heuristics:false, moves:false, pv:false, time:false, stage:false,
};

class RingBuffer {
  constructor(cap) { this.capacity=cap; this.buffer=new Array(cap); this.head=0; this.size=0; }
  push(item) { this.buffer[this.head]=item; this.head=(this.head+1)%this.capacity; if(this.size<this.capacity)this.size++; }
  toArray()  { return this.size<this.capacity ? this.buffer.slice(0,this.size)
               : [...this.buffer.slice(this.head),...this.buffer.slice(0,this.head)]; }
  clear()    { this.buffer.fill(undefined); this.head=0; this.size=0; }
}

class SampledWriter {
  constructor(stream, rate=1000) { this.stream=stream; this.sampleRate=rate; this.counter=0; this.dropped=0; }
  write(obj) { this.counter++; if(this.counter%this.sampleRate!==0){this.dropped++;return;}
               this.stream.write(JSON.stringify(obj)+'\n'); }
  writeAlways(obj) { this.stream.write(JSON.stringify(obj)+'\n'); }
  stats() { return { written:this.counter-this.dropped, dropped:this.dropped }; }
}

function makeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// ─────────────────────────────────────────────────────────────────────────────
class EngineLogger {
  constructor(opts = {}) {
    this.enabledMask = LOG_CATEGORY.NONE;
    this.turnRingSize = opts.turnRingSize ?? 8;
    this.nodeSampleRate = opts.nodeSampleRate ?? 1000;
    this.maxCandidatesPerTurn = opts.maxCandidatesPerTurn ?? 10;
    this.sessionId = `s${Date.now().toString(36)}`;
    this.gameId = null;
    this.turnNumber = 0;
    this.turnData = null;
    this.recentTurns = new RingBuffer(this.turnRingSize);

    // ── Main timestamped log file ──
    fs.mkdirSync(LOG_DIR, { recursive: true });
    this._mainPath = path.join(LOG_DIR, `${makeTimestamp()}.log`);
    this._mainStream = fs.createWriteStream(this._mainPath, { flags: 'a', highWaterMark: 64*1024 });

    this._turnStream = null;
    this._traceWriters = new Map();

    // Periodic flush every 5 s
    this._flushTimer = setInterval(() => this._flushAll(), 5000);
    if (this._flushTimer.unref) this._flushTimer.unref();   // don't keep process alive
  }

  /** Write a plain-text line to the main session log file. */
  write(msg) {
    if (this._mainStream) {
      const ts = new Date().toISOString();
      this._mainStream.write(`[${ts}] ${msg}\n`);
    }
  }

  // ── Category control ──
  setEnabledCategories(mask) {
    this.enabledMask = mask;
    LOG.search     = (mask & LOG_CATEGORY.SEARCH) !== 0;
    LOG.eval       = (mask & LOG_CATEGORY.EVAL) !== 0;
    LOG.moveOrder  = (mask & LOG_CATEGORY.MOVE_ORDER) !== 0;
    LOG.tt         = (mask & LOG_CATEGORY.TT) !== 0;
    LOG.uci        = (mask & LOG_CATEGORY.UCI) !== 0;
    LOG.book       = (mask & LOG_CATEGORY.BOOK) !== 0;
    LOG.heuristics = (mask & LOG_CATEGORY.HEURISTICS) !== 0;
    LOG.moves      = (mask & LOG_CATEGORY.MOVES) !== 0;
    LOG.pv         = (mask & LOG_CATEGORY.PV) !== 0;
    LOG.time       = (mask & LOG_CATEGORY.TIME) !== 0;
    LOG.stage      = (mask & LOG_CATEGORY.STAGE) !== 0;
  }
  isEnabled(cat) { return (this.enabledMask & cat) !== 0; }

  // ── Lazy streams ──
  _getTurnStream() {
    if (this._turnStream) return this._turnStream;
    fs.mkdirSync(TURN_LOG_DIR, { recursive: true });
    const file = path.join(TURN_LOG_DIR, `${this.gameId||this.sessionId}.ndjson`);
    this._turnStream = fs.createWriteStream(file, { flags:'a', highWaterMark:64*1024 });
    return this._turnStream;
  }
  _getTraceWriter(cat) {
    let w = this._traceWriters.get(cat);
    if (w) return w;
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const name = CATEGORY_NAMES[cat] || `cat${cat}`;
    const stream = fs.createWriteStream(path.join(LOG_DIR, `${name}.ndjson`), { flags:'a', highWaterMark:64*1024 });
    w = new SampledWriter(stream, this.nodeSampleRate);
    this._traceWriters.set(cat, w);
    return w;
  }

  // ── Game / turn lifecycle ──
  startNewGame(gameId=null) {
    if (this._turnStream) { this._turnStream.end(); this._turnStream = null; }
    this.gameId = gameId || `g${Date.now().toString(36)}`;
    this.turnNumber = 0;
    this.recentTurns.clear();
    this.write(`[GAME] new game ${this.gameId}`);
  }
  startTurn(fen, color, stageInfo) {
    this.turnNumber++;
    this.turnData = { t:this.turnNumber, ts:Date.now(), fen, color,
      stage:stageInfo?.stage??null, phase:stageInfo?.phasePercent??null,
      candidates:[], best:null, score:0, depth:0, nodes:0, qnodes:0, time:0, pv:null,
      nSearch:0, nEval:0, nOrder:0, warnings:null, errors:null };
    return this.turnNumber;
  }
  recordCandidateMove(move, score, orderScore, evalBreakdown) {
    const td = this.turnData; if (!td) return;
    const cands = td.candidates, max = this.maxCandidatesPerTurn;
    if (cands.length >= max && score <= cands[cands.length-1].s) return;
    const keepBD = cands.length < 3;
    const rec = { m:move.algebraic, s:score, o:orderScore, cap:move.capturedPiece??null,
                  tt:move.isTTMove||false, k:move.isKiller||false, eb:keepBD?evalBreakdown:null };
    let i = cands.length; while(i>0 && cands[i-1].s<score) i--;
    cands.splice(i, 0, rec);
    if (cands.length > max) cands.length = max;
  }
  finalizeTurn(bestMove, sr) {
    const td = this.turnData; if (!td) return;
    td.best=bestMove?.algebraic??null; td.score=sr?.score??0; td.depth=sr?.depth??0;
    td.nodes=sr?.nodes??0; td.qnodes=sr?.qNodes??0; td.time=sr?.time??0;
    td.pv=sr?.pv?.map(m=>m.algebraic).join(' ')??null;
    if (this.enabledMask !== LOG_CATEGORY.NONE)
      this._getTurnStream().write(JSON.stringify(td)+'\n');
    this.write(`[TURN ${td.t}] ${td.color} best=${td.best} cp=${td.score} d=${td.depth} n=${td.nodes} t=${td.time}ms`);
    this.recentTurns.push(td);
    this.turnData = null;
  }
  addTurnWarning(type, message) {
    const td = this.turnData; if (td) { if(!td.warnings)td.warnings=[]; td.warnings.push({type,message}); }
    this.write(`[WARN T${this.turnNumber}] ${type}: ${message}`);
  }
  addTurnError(type, message, details) {
    const td = this.turnData;
    if (td) { if(!td.errors)td.errors=[]; td.errors.push({type,message}); }
    this.write(`[ERROR T${this.turnNumber}] ${type}: ${message}`);
    if (details?.stack) this.write(details.stack);
  }

  // ── Hot-path trace ──
  searchNode(depth,ply,alpha,beta,mc) {
    const td=this.turnData; if(td)td.nSearch++;
    this._getTraceWriter(LOG_CATEGORY.SEARCH).write({t:this.turnNumber,d:depth,p:ply,a:alpha,b:beta,mc});
  }
  evalPoint(score,phase) {
    const td=this.turnData; if(td)td.nEval++;
    this._getTraceWriter(LOG_CATEGORY.EVAL).write({t:this.turnNumber,s:score,ph:phase});
  }
  moveOrderPoint(ply,topMove,topScore,count) {
    const td=this.turnData; if(td)td.nOrder++;
    this._getTraceWriter(LOG_CATEGORY.MOVE_ORDER).write({t:this.turnNumber,p:ply,m:topMove,s:topScore,c:count});
  }

  // ── Non-hot-path ──
  uci(level,data,message) {
    if (level==='error') { this.write(`[UCI ERROR] ${message}`); this.addTurnError('uci',message,data); return; }
    if (level==='warn') this.write(`[UCI WARN] ${message}`);
    if (!LOG.uci) return;
    this._getTraceWriter(LOG_CATEGORY.UCI).writeAlways({t:this.turnNumber,lvl:level,msg:message,...data});
  }
  book(level,data,message) {
    if (!LOG.book) return;
    this._getTraceWriter(LOG_CATEGORY.BOOK).writeAlways({t:this.turnNumber,lvl:level,msg:message,...data});
  }

  // ── Legacy category methods ──
  _legacyLog(enabled,category,level,data,message) {
    if (level==='error') { this.write(`[${(CATEGORY_NAMES[category]||'log').toUpperCase()} ERROR] ${message}`);
      this.addTurnError(CATEGORY_NAMES[category]||'log',message,data); return; }
    if (!enabled) return;
    if (level==='warn') this.write(`[${(CATEGORY_NAMES[category]||'log').toUpperCase()} WARN] ${message}`);
    this._getTraceWriter(category).writeAlways({t:this.turnNumber,lvl:level,msg:message,...data});
  }
  search(l,d,m)     { this._legacyLog(LOG.search,     LOG_CATEGORY.SEARCH,     l,d,m); }
  eval(l,d,m)       { this._legacyLog(LOG.eval,       LOG_CATEGORY.EVAL,       l,d,m); }
  moveOrder(l,d,m)  { this._legacyLog(LOG.moveOrder,  LOG_CATEGORY.MOVE_ORDER, l,d,m); }
  tt(l,d,m)         { this._legacyLog(LOG.tt,         LOG_CATEGORY.TT,         l,d,m); }
  heuristics(l,d,m) { this._legacyLog(LOG.heuristics, LOG_CATEGORY.HEURISTICS, l,d,m); }
  moves(l,d,m)      { this._legacyLog(LOG.moves,      LOG_CATEGORY.MOVES,      l,d,m); }
  pv(l,d,m)         { this._legacyLog(LOG.pv,         LOG_CATEGORY.PV,         l,d,m); }
  time(l,d,m)       { this._legacyLog(LOG.time,       LOG_CATEGORY.TIME,       l,d,m); }
  stage(l,d,m)      { this._legacyLog(LOG.stage,      LOG_CATEGORY.STAGE,      l,d,m); }

  // ── Introspection ──
  getRecentTurns() { return this.recentTurns.toArray(); }
  getCurrentTurn() { return this.turnData; }
  getTraceStats()  { const o={}; for(const[c,w]of this._traceWriters)o[CATEGORY_NAMES[c]]=w.stats(); return o; }

  // ── Flush / close ──
  // NOTE: stream.write('') is a no-op on a Writable and does NOT force a
  // flush — Node flushes its internal buffer on its own schedule. This timer
  // therefore only guarantees the event loop gets a chance to drain. The real
  // durability guarantee is flushSync() in the crash handlers.
  // TODO: if durability of the last few lines matters, switch the main log to
  // fs.writeSync on a plain fd.
  _flushAll() {
    if (this._mainStream && !this._mainStream.destroyed)
      this._mainStream.write('');   // triggers internal flush
    if (this._turnStream && !this._turnStream.destroyed)
      this._turnStream.write('');
    for (const w of this._traceWriters.values())
      if (w.stream && !w.stream.destroyed) w.stream.write('');
  }
  async flush() {
    this._flushAll();
    await new Promise(r => setTimeout(r, 200));
  }
  /** Synchronous best-effort flush for crash handlers. */
  flushSync() {
    try {
      if (this._mainStream && !this._mainStream.destroyed) {
        fs.fdatasyncSync(this._mainStream.fd);
      }
    } catch { /* best effort */ }
  }
  close() {
    clearInterval(this._flushTimer);
    if (this._mainStream)  { this._mainStream.end();  this._mainStream = null; }
    if (this._turnStream)  { this._turnStream.end();  this._turnStream = null; }
    for (const w of this._traceWriters.values()) w.stream.end();
    this._traceWriters.clear();
  }
  clearLogs() {
    this.close();
    for (const dir of [LOG_DIR, TURN_LOG_DIR]) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isFile()) fs.unlinkSync(p);
      }
    }
    this.recentTurns.clear();
    // Re-open main stream
    fs.mkdirSync(LOG_DIR, { recursive: true });
    this._mainPath = path.join(LOG_DIR, `${makeTimestamp()}.log`);
    this._mainStream = fs.createWriteStream(this._mainPath, { flags:'a', highWaterMark:64*1024 });
    this._flushTimer = setInterval(() => this._flushAll(), 5000);
    if (this._flushTimer.unref) this._flushTimer.unref();
  }
}

// ── Noop logger ──
class NoopLogger {
  setEnabledCategories(){}  isEnabled(){return false;}
  startNewGame(){}  startTurn(){return 0;}  recordCandidateMove(){}
  finalizeTurn(){}  addTurnWarning(){}
  addTurnError(t,m,d){console.error(`[${t}] ${m}`); if(d?.stack)console.error(d.stack);}
  searchNode(){}  evalPoint(){}  moveOrderPoint(){}
  uci(l,d,m){if(l==='error')console.error(`[UCI] ${m}`,d);}
  book(){}  write(){}
  getRecentTurns(){return[];}  getCurrentTurn(){return null;}  getTraceStats(){return{};}
  async flush(){}  flushSync(){}  close(){}  clearLogs(){}
  _errOnly(label,level,msg){if(level==='error')console.error(`[${label}] ${msg}`);}
  search(l,d,m){this._errOnly('SEARCH',l,m);}  eval(l,d,m){this._errOnly('EVAL',l,m);}
  moveOrder(l,d,m){this._errOnly('MOVE_ORDER',l,m);}  tt(l,d,m){this._errOnly('TT',l,m);}
  heuristics(l,d,m){this._errOnly('HEURISTICS',l,m);}  moves(l,d,m){this._errOnly('MOVES',l,m);}
  pv(l,d,m){this._errOnly('PV',l,m);}  time(l,d,m){this._errOnly('TIME',l,m);}
  stage(l,d,m){this._errOnly('STAGE',l,m);}
}

// In a production bundle this folds to `new NoopLogger()` and the EngineLogger
// constructor — which creates logs/, opens a write stream and starts a 5s
// interval — never runs at import time. server.js previously swapped in the
// NoopLogger, but only AFTER the real one had already touched the filesystem.
let _instance = __DEV__ ? new EngineLogger() : new NoopLogger();
export function installNoopLogger() { _instance.close(); _instance=new NoopLogger(); for(const k of Object.keys(LOG))LOG[k]=false; }
export function installRealLogger(opts) { if(_instance instanceof EngineLogger)_instance.close(); _instance=new EngineLogger(opts); }

const logger = new Proxy({}, { get(_,prop) { return typeof _instance[prop]==='function' ? _instance[prop].bind(_instance) : _instance[prop]; } });
export default logger;
export { LOG_CATEGORY, GAME_STAGE };