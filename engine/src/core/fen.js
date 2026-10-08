/**
 * FEN validation. Board.fromFen() trusts its input — a malformed FEN produces
 * a board whose bitboards and pieceList disagree, which the search then walks
 * into undefined behaviour. Everything that accepts a FEN from outside
 * (`position fen`, `validatefen`, the client's start-position setting) goes
 * through here first.
 *
 * @returns {{ok:boolean, reason:string|null, fen:string|null}}  `fen` is the
 *          normalised 6-field form when ok.
 */
import { Board } from './board.js';
import { isInCheck } from './moveGeneration.js';


const ROW_RE = /^[pnbrqkPNBRQK1-8]+$/;
const CASTLE_RE = /^(-|K?Q?k?q?)$/;


export function validateFen(input) {
  const fail = (reason) => ({ ok: false, reason, fen: null });
  if (typeof input !== 'string') return fail('not_a_string');
  const parts = input.trim().split(/\s+/);
  if (parts.length < 4 || parts.length > 6) return fail('expected_4_to_6_fields');
  const [placement, side, castling, ep] = parts;
  const half = parts[4] ?? '0';
  const full = parts[5] ?? '1';
  const rows = placement.split('/');
  if (rows.length !== 8) return fail('expected_8_ranks');
  const grid = new Array(64).fill('');
  const count = Object.create(null);
  for (let r = 0; r < 8; r++) {
    const rank = 8 - r;
    const row = rows[r];
    if (!ROW_RE.test(row)) return fail(`bad_character_rank_${rank}`);
    let file = 0, prevDigit = false;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        if (prevDigit) return fail(`adjacent_digits_rank_${rank}`);
        file += ch.charCodeAt(0) - 48;
        prevDigit = true;
      } else {
        if (file < 8) grid[(rank - 1) * 8 + file] = ch;
        file++;
        prevDigit = false;
        count[ch] = (count[ch] || 0) + 1;
      }
      if (file > 8) return fail(`rank_${rank}_too_long`);
    }
    if (file !== 8) return fail(`rank_${rank}_too_short`);
  }
  if (count.K !== 1 || count.k !== 1) return fail('need_exactly_one_king_each');
  if ((count.P || 0) > 8 || (count.p || 0) > 8) return fail('too_many_pawns');
  let white = 0, black = 0;
  for (const k in count) { if (k === k.toUpperCase()) white += count[k]; else black += count[k]; }
  if (white > 16 || black > 16) return fail('too_many_pieces');
  for (let f = 0; f < 8; f++) {
    const a = grid[f], b = grid[56 + f];
    if (a === 'P' || a === 'p' || b === 'P' || b === 'p') return fail('pawn_on_back_rank');
  }
  if (side !== 'w' && side !== 'b') return fail('side_to_move');
  if (castling === '' || !CASTLE_RE.test(castling)) return fail('castling_field');
  if (castling.includes('K') && !(grid[4] === 'K' && grid[7] === 'R'))   return fail('castling_K_inconsistent');
  if (castling.includes('Q') && !(grid[4] === 'K' && grid[0] === 'R'))   return fail('castling_Q_inconsistent');
  if (castling.includes('k') && !(grid[60] === 'k' && grid[63] === 'r')) return fail('castling_k_inconsistent');
  if (castling.includes('q') && !(grid[60] === 'k' && grid[56] === 'r')) return fail('castling_q_inconsistent');
  if (ep !== '-') {
    if (!/^[a-h][36]$/.test(ep)) return fail('en_passant_square');
    const f = ep.charCodeAt(0) - 97;
    const rank = ep.charCodeAt(1) - 48;
    if (side === 'w' ? rank !== 6 : rank !== 3) return fail('en_passant_rank');
    const sq = (rank - 1) * 8 + f;
    const pawnSq = side === 'w' ? sq - 8 : sq + 8;
    const originSq = side === 'w' ? sq + 8 : sq - 8;
    if (grid[sq] !== '' || grid[originSq] !== '' || grid[pawnSq] !== (side === 'w' ? 'p' : 'P')) {
      return fail('en_passant_inconsistent');
    }
  }
  if (!/^\d+$/.test(half) || !/^\d+$/.test(full) || parseInt(full, 10) < 1) return fail('move_counters');
  const fen = [placement, side, castling, ep, half, full].join(' ');
  let board;
  try { board = Board.fromFen(fen); }
  catch (err) { return fail(`parse_error:${err.message}`); }
  if (isInCheck(board, side === 'w' ? 'black' : 'white')) return fail('side_not_to_move_in_check');
  return { ok: true, reason: null, fen };
}

export default validateFen;