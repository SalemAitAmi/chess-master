/**
 * Settings → UCI. The only place a client setting becomes a wire command.
 *
 * `Profile` is pushed FIRST and alone when it differs from baseline, because
 * the engine treats a profile as a whole-config swap: pushing it after the
 * individual options would discard them.
 */
import { ENGINE_OPTIONS } from '../constants/engineOptions';
import { reportFailure } from './failure';

export function settingsToCommands(settings) {
  const out = [];
  const profile = settings.profile;
  if (profile !== undefined && profile !== null) out.push(['Profile', String(profile)]);
  for (const o of ENGINE_OPTIONS) {
    if (o.local || o.id === 'profile') continue;
    const v = settings[o.id];
    if (v === undefined || v === null) continue;
    out.push([o.uci, o.type === 'check' ? String(Boolean(v)) : String(v)]);
  }
  return out;
}

/** @returns {boolean} false on the first failure (and reports it). */
export function pushSettings(engine, settings) {
  if (!engine || !engine.connected) {
    reportFailure('engineConfig.pushSettings', new Error('engine not connected'));
    return false;
  }
  for (const [name, value] of settingsToCommands(settings)) {
    try {
      engine.setOption(name, value);
    } catch (err) {
      reportFailure(`engineConfig.pushSettings(${name})`, err);
      return false;
    }
  }
  return true;
}