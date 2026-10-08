/**
 * EngineSession — isolation boundary between engine instances.
 * One instance per connection; a taken name gets a suffixed instance
 * (`e0` → `e0.2`), never the live one. The handler records its own config.
 */
import { UCIHandler } from './uciHandler.js';
import logger, { LogContext } from '../logging/logger.js';
const __LOG__ = globalThis.__LOG__ ?? true;
const sessions = new Map();
export function getOrCreateSession(id) {
  let s = sessions.get(id);
  if (s === undefined) { s = new EngineSession(id); sessions.set(id, s); }
  return s;
}
export function dropSession(id) { sessions.delete(id); }
export class EngineSession {
  constructor(id) {
    this.id = id;
    this.instances = new Map();
    this.pendingReset = new Set();
    this.gameNumber = 0;
  }
  register(requestedName, profileName) {
    let name = requestedName, k = 2;
    while (this.instances.has(name)) name = `${requestedName}.${k++}`;
    const inst = new EngineInstance(this, name, profileName);
    this.instances.set(name, inst);
    if (__LOG__ && name !== requestedName) {
      logger.bind(inst.logCtx);
      logger.write(`[INSTANCE] ${this.id}/${requestedName} is live; new connection isolated as ${inst.key}`);
    }
    return inst;
  }
  unregister(name) {
    const inst = this.instances.get(name);
    if (inst !== undefined) inst.dispose();
    this.instances.delete(name);
    this.pendingReset.delete(name);
    if (this.instances.size === 0) dropSession(this.id);
  }
  noteNewGame(name) {
    this.pendingReset.add(name);
    const keys = [...this.instances.keys()];
    if (keys.length === 0 || !keys.every(n => this.pendingReset.has(n))) return this.gameNumber;
    this.pendingReset.clear();
    this.gameNumber = __LOG__ ? logger.armGame() : this.gameNumber + 1;
    return this.gameNumber;
  }
  describe() {
    return [...this.instances.values()].map(i => `${i.name}:${i.cfg.profile}/${i.cfg.hash}`).join(' ');
  }
}
export class EngineInstance {
  constructor(session, name, profileName) {
    this.session = session;
    this.name = name;
    this.key = `${session.id}/${name}`;
    this.logCtx = new LogContext(name);
    this.handler = new UCIHandler({
      instanceId: name, owner: this.key, session, logCtx: this.logCtx, profile: profileName,
    });
  }
  get cfg() { return this.handler.cfg; }
  ttId() { return this.handler.tableId(); }
  async dispatch(line) {
    if (__LOG__) logger.bind(this.logCtx);
    const res = await this.handler.handleCommand(line);
    if (__LOG__) logger.bind(this.logCtx);
    return res;
  }
  dispose() { this.handler.quit(); }
}