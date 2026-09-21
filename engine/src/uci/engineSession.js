/**
 * EngineSession — the isolation boundary between engine instances.
 *
 * ONE INSTANCE PER CONNECTION. Each instance owns a UCIHandler, hence its own
 * SearchEngine, its own TranspositionTable, its own killer/history/counter
 * tables, and its own resolved config. Nothing is shared between instances
 * except the log session and the game number.
 *
 * This is the fix for "opposing engines explore the same lines": previously the
 * Colosseum drove both bots through one UCIHandler, so every position White
 * searched was already in the table, scored and best-moved, when Black searched
 * it. They were not two engines; they were one engine alternating colours.
 *
 * GAME NUMBERING. A game ends when EVERY registered instance has issued
 * `ucinewgame`. Rotating on the first one would split one game across two
 * directories whenever the second instance resets a few milliseconds later.
 *
 * Instances are created LAZILY by the server (see server.js): a connection that
 * sends a `session` handshake must never leave a throw-away solo instance
 * behind, because registration writes a record to instances.ndjson and that
 * file is the analyser's engine dictionary.
 */
import { UCIHandler } from './uciHandler.js';
import { resolveProfile } from '../config/profiles.js';
import logger, { LogContext, CAT, LOG } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;

const sessions = new Map();

export function getOrCreateSession(id) {
  let s = sessions.get(id);
  if (s === undefined) { s = new EngineSession(id); sessions.set(id, s); }
  return s;
}
export function dropSession(id) { sessions.delete(id); }
export function listSessions() {
  return [...sessions.values()].map(s => ({ id: s.id, instances: [...s.instances.keys()] }));
}

export class EngineSession {
  constructor(id) {
    this.id = id;
    this.instances = new Map();       // name -> EngineInstance
    this.pendingReset = new Set();
    this.gameNumber = 0;
  }

  register(name, profileName) {
    const existing = this.instances.get(name);
    if (existing !== undefined) return existing;

    const inst = new EngineInstance(this, name, profileName);
    this.instances.set(name, inst);
    if (__LOG__) {
      logger.sessionRecord('instances.ndjson', {
        session: this.id, eng: name, profile: inst.profile.name,
        label: inst.profile.label, description: inst.profile.description,
        configHash: inst.profile.hash, tt: inst.ttId(), config: inst.profile.config,
      });
      logger.bind(inst.logCtx);
      logger.write(`[INSTANCE] ${this.id}/${name} profile=${inst.profile.name} ` +
                   `cfg=${inst.profile.hash} tt=${inst.ttId()}`);
    }
    return inst;
  }

  unregister(name) {
    if (name === null || name === undefined) return;
    const inst = this.instances.get(name);
    if (inst !== undefined) inst.dispose();
    this.instances.delete(name);
    this.pendingReset.delete(name);
    if (this.instances.size === 0) dropSession(this.id);
  }

  /**
   * Called by UCIHandler on `ucinewgame`. ARMS the next game once every
   * instance has reset; the directory is created by the first `go` (see
   * logger.armGame / beginGameIfArmed). Arming rather than rotating is what
   * keeps the reset barrier itself out of both games.
   */
  noteNewGame(name) {
    this.pendingReset.add(name);
    const keys = [...this.instances.keys()];
    const all = keys.length > 0 && keys.every(n => this.pendingReset.has(n));
    if (!all) return this.gameNumber;
    this.pendingReset.clear();
    this.gameNumber = __LOG__ ? logger.armGame() : this.gameNumber + 1;
    return this.gameNumber;
  }

  describe() {
    return [...this.instances.values()]
      .map(i => `${i.name}:${i.profile.name}/${i.profile.hash}`).join(' ');
  }
}

export class EngineInstance {
  constructor(session, name, profileName) {
    this.session = session;
    this.name = name;
    this.profile = resolveProfile(profileName);
    this.logCtx = new LogContext(name);
    // The handler — and therefore the transposition table — is private here.
    this.handler = new UCIHandler(this.profile.config, {
      instanceId: name, session, logCtx: this.logCtx, profile: this.profile,
    });
  }

  /** Identity of this instance's transposition table, for log verification. */
  ttId() {
    const tt = this.handler.engine.tt;
    return tt === null ? 'none' : `${tt.size}@${this.profile.hash}`;
  }

  /**
   * Bind this instance's log context, then dispatch. Re-bound after the await
   * because `go` awaits the book promise and another instance could interleave
   * at that point.
   */
  async dispatch(line) {
    if (__LOG__) logger.bind(this.logCtx);
    const res = await this.handler.handleCommand(line);
    if (__LOG__) logger.bind(this.logCtx);
    return res;
  }

  dispose() { this.handler.quit(); }
}
