/**
 * UCI-level test harness. Since UCIHandler is the engine's only public
 * interface, integration tests must drive it through command strings.
 */
import { UCIHandler } from '../../src/uci/uciHandler.js';

export function parseStateBlock(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(' ');
    if (i === -1) continue;
    const key = line.slice(0, i);
    const value = line.slice(i + 1);
    if (['incheck', 'canundo', 'blunder'].includes(key)) out[key] = value === 'true';
    else if (['fullmove', 'halfmove', 'legalmovecount', 'eval', 'movecount',
              'material_white', 'material_black', 'material_diff', 'repetitions'].includes(key)) {
      out[key] = parseInt(value, 10) || 0;
    } else if (key === 'history' || key === 'historyuci') {
      out[key] = value === 'none' ? [] : value.split(' ');
    } else out[key] = value;
  }
  return out;
}

export class UciSession {
  constructor(config = {}) {
    this.handler = new UCIHandler({ useOpeningBook: false, ...config });
  }
  cmd(line) { return this.handler.handleCommand(line); }
  async setPosition(fen, moves = []) {
    await this.cmd(`position fen ${fen}${moves.length ? ' moves ' + moves.join(' ') : ''}`);
  }
  async state() { return parseStateBlock(await this.cmd('gamestate')); }
  async play(uci) { return parseStateBlock(await this.cmd(`makemove ${uci}`)); }
  async bestMove(depth) {
    const res = await this.cmd(`go depth ${depth}`);
    return res.split('\n').find(l => l.startsWith('bestmove')).split(' ')[1];
  }
}