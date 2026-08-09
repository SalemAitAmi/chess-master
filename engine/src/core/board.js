/**
 * Board representation with zero-allocation make/unmake.
 *
 * Memory model:
 *   - Undo info lives in a pre-allocated ring of 512 flat objects.
 *   - makeMove writes scalars into the current slot; no `new`, no clone.
 *   - undoMove reads the slot back. Stack pointer is a single integer.
 *   - GameState is mutated in place; no per-move GameState instances.
 */

import { PIECES, CASTLING, WHITE_IDX, BLACK_IDX } from './constants.js';
import {
  BitBoard, initializeBitboards, initializePieceList,
  squareToIndex, indexToSquare, colorToIndex, getPieceColor,
} from './bitboard.js';
import {
  computeZobristKey, getEnPassantZobristIndex,
  PIECE_SQUARE_KEYS, CASTLING_KEYS, SIDE_KEYS, EN_PASSANT_KEYS,
} from '../tables/zobrist.js';

// Undo stack depth: game moves (~300 max) + search depth (~128) + safety
const UNDO_STACK_SIZE = 512;

/**
 * Allocate one undo frame. Called UNDO_STACK_SIZE times at board construction,
 * never again. The shape is fixed so V8 keeps it as a fast hidden class.
 */
function createUndoFrame() {
  return {
    // Move identity
    from: 0,
    to: 0,
    movingPiece: 0,
    capturedPiece: 0,
    promotionPiece: 0,
    // Special-move undo info (−1 = not applicable)
    epCaptureSquare: -1,       // square where en-passant victim was removed
    castleRookFrom: -1,        // rook's original square if castling
    castleRookTo: -1,
    // GameState snapshot — scalars only, replaces the old GameState.clone()
    prevCastling: 0,
    prevEpSquare: -1,
    prevHalfMove: 0,
    prevFullMove: 1,
    prevZobrist: 0n,
    // activeColor is always the opposite after a move — no need to store
  };
}

export class GameState {
  constructor() {
    this.activeColor = 'white';
    this.castling = CASTLING.ALL;
    this.halfMoveClock = 0;
    this.enPassantSquare = -1;
    this.fullMoveCount = 1;
    this.zobristKey = 0n;
  }
}

export class Board {
  constructor() {
    const { bbPieces, bbSide } = initializeBitboards();
    this.bbPieces = bbPieces;
    this.bbSide = bbSide;
    this.pieceList = initializePieceList();
    this.gameState = new GameState();

    // ── Pre-allocated undo stack ──
    // This is the entire move history for the board. makeMove increments
    // _undoPly and writes into _undo[_undoPly-1]; undoMove decrements and reads.
    // Zero allocation in the hot path.
    this._undo = new Array(UNDO_STACK_SIZE);
    for (let i = 0; i < UNDO_STACK_SIZE; i++) this._undo[i] = createUndoFrame();
    this._undoPly = 0;

    this.gameState.zobristKey = computeZobristKey(this);
  }

  /** Number of half-moves made on this board (game moves + search moves). */
  get plyCount() { return this._undoPly; }

  /**
   * Count how many times the current Zobrist key appears in the undo history.
   * Walks backwards through the frames until the half-move clock resets,
   * because an irreversible move (capture / pawn push) makes any earlier
   * position unreachable by repetition.
   *
   * Returns the count INCLUDING the current position, so:
   *   1 = first occurrence, 2 = first repetition, 3 = threefold.
   *
   * Same-side positions are two plies apart, so we step by 2.
   */
  countRepetitions() {
    const key = this.gameState.zobristKey;
    const limit = this.gameState.halfMoveClock;   // reversible moves available to scan
    let count = 1;

    // u.prevZobrist at frame i is the key BEFORE move i was made.
    // The key N plies ago lives at _undo[_undoPly - N].prevZobrist.
    // Same side to move ⇒ N must be even. Start at N=2.
    for (let back = 2; back <= limit && back <= this._undoPly; back += 2) {
      if (this._undo[this._undoPly - back].prevZobrist === key) {
        count++;
      }
    }
    return count;
  }

  /**
   * True if the current position has occurred at least `threshold` times.
   * Threshold 2 = "this is a repeat" (search-time draw scoring).
   * Threshold 3 = "threefold" (game-termination rule).
   */
  isRepetition(threshold = 2) {
    return this.countRepetitions() >= threshold;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // makeMove — ZERO ALLOCATIONS
  // All undo info is written into the pre-allocated frame at _undo[_undoPly].
  // ─────────────────────────────────────────────────────────────────────────
    makeMove(fromSquare, toSquare, promotionPiece = null) {
    if (fromSquare < 0 || fromSquare >= 64 || toSquare < 0 || toSquare >= 64) return false;
    if (this._undoPly >= UNDO_STACK_SIZE) {
      throw new Error(`Board undo stack overflow at ply ${this._undoPly}`);
    }

    const gs = this.gameState;
    const u = this._undo[this._undoPly++];
    const movingPiece = this.pieceList[fromSquare];
    const capturedPiece = this.pieceList[toSquare];
    const movingColor = gs.activeColor;
    const oppositeColor = movingColor === 'white' ? 'black' : 'white';
    const movingColorIdx = colorToIndex(movingColor);
    const oppositeColorIdx = colorToIndex(oppositeColor);

    this._snapshotUndo(u, fromSquare, toSquare, movingPiece, capturedPiece, promotionPiece, gs);
    this._liftPiece(gs, movingColorIdx, movingPiece, fromSquare);

    if (capturedPiece !== PIECES.NONE) {
      this._removeCapture(gs, oppositeColorIdx, capturedPiece, toSquare);
    } else {
      gs.halfMoveClock++;
    }

    let finalPiece = movingPiece;

    if (movingPiece === PIECES.PAWN) {
      finalPiece = this._handlePawnMove(
        gs, u, fromSquare, toSquare, promotionPiece,
        movingColor, movingColorIdx, oppositeColor, oppositeColorIdx
      );
    } else {
      gs.enPassantSquare = -1;
    }

    if (movingPiece === PIECES.KING) {
      this._handleKingMove(gs, u, fromSquare, toSquare, movingColor, movingColorIdx);
    }

    this._updateCastlingRights(gs, movingPiece, capturedPiece, fromSquare, toSquare, movingColor);
    this._placePiece(gs, movingColorIdx, finalPiece, toSquare);

    if (movingColor === 'black') gs.fullMoveCount++;

    this._updateZobristEpAndCastling(gs, u.prevCastling, u.prevEpSquare);
    this._flipSideToMove(gs, movingColor, oppositeColor);

    return true;
  }

  _snapshotUndo(u, from, to, movingPiece, capturedPiece, promotionPiece, gs) {
    u.from = from;
    u.to = to;
    u.movingPiece = movingPiece;
    u.capturedPiece = capturedPiece;
    u.promotionPiece = promotionPiece || 0;
    u.epCaptureSquare = -1;
    u.castleRookFrom = -1;
    u.castleRookTo = -1;
    u.prevCastling = gs.castling;
    u.prevEpSquare = gs.enPassantSquare;
    u.prevHalfMove = gs.halfMoveClock;
    u.prevFullMove = gs.fullMoveCount;
    u.prevZobrist = gs.zobristKey;
  }

  _liftPiece(gs, colorIdx, piece, square) {
    gs.zobristKey ^= PIECE_SQUARE_KEYS[colorIdx][piece][square];
    this.bbPieces[colorIdx][piece].clearBit(square);
    this.bbSide[colorIdx].clearBit(square);
    this.pieceList[square] = PIECES.NONE;
  }

  _placePiece(gs, colorIdx, piece, square) {
    gs.zobristKey ^= PIECE_SQUARE_KEYS[colorIdx][piece][square];
    this.bbPieces[colorIdx][piece].setBit(square);
    this.bbSide[colorIdx].setBit(square);
    this.pieceList[square] = piece;
  }

  _removeCapture(gs, oppositeColorIdx, capturedPiece, square) {
    gs.zobristKey ^= PIECE_SQUARE_KEYS[oppositeColorIdx][capturedPiece][square];
    this.bbPieces[oppositeColorIdx][capturedPiece].clearBit(square);
    this.bbSide[oppositeColorIdx].clearBit(square);
    gs.halfMoveClock = 0;
  }

  _handlePawnMove(gs, u, from, to, promotionPiece, movingColor, movingColorIdx, oppositeColor, oppositeColorIdx) {
    gs.halfMoveClock = 0;

    this._handleEnPassantCapture(gs, u, from, to, oppositeColor, oppositeColorIdx);

    gs.enPassantSquare = -1;
    this._handleDoublePush(gs, from, to, movingColor);

    return this._handlePromotion(u, from, to, promotionPiece, movingColor);
  }

  _handleEnPassantCapture(gs, u, from, to, oppositeColor, oppositeColorIdx) {
    if (gs.enPassantSquare === -1) return;

    const fromRank = from >> 3, fromFile = from & 7;
    const toRank = to >> 3, toFile = to & 7;

    if (Math.abs(fromFile - toFile) !== 1 || Math.abs(fromRank - toRank) !== 1) return;
    if (this.pieceList[to] !== PIECES.NONE) return;   // normal capture, not e.p.

    const captureSquare = (fromRank << 3) | toFile;

    if (this.pieceList[captureSquare] !== PIECES.PAWN) return;
    if (getPieceColor(this.bbSide, captureSquare) !== oppositeColor) return;

    gs.zobristKey ^= PIECE_SQUARE_KEYS[oppositeColorIdx][PIECES.PAWN][captureSquare];
    this.bbPieces[oppositeColorIdx][PIECES.PAWN].clearBit(captureSquare);
    this.bbSide[oppositeColorIdx].clearBit(captureSquare);
    this.pieceList[captureSquare] = PIECES.NONE;
    u.epCaptureSquare = captureSquare;
  }

  _handleDoublePush(gs, from, to, movingColor) {
    const fromRank = from >> 3, toRank = to >> 3;
    if (Math.abs(fromRank - toRank) === 2) {
      gs.enPassantSquare = movingColor === 'white' ? to - 8 : to + 8;
    }
  }

  _handlePromotion(u, from, to, promotionPiece, movingColor) {
    const toRank = to >> 3;
    const isPromoRank = (movingColor === 'white' && toRank === 7) ||
                        (movingColor === 'black' && toRank === 0);
    if (!isPromoRank) return PIECES.PAWN;

    const finalPiece = promotionPiece || PIECES.QUEEN;
    u.promotionPiece = finalPiece;
    return finalPiece;
  }

  _handleKingMove(gs, u, from, to, movingColor, movingColorIdx) {
    if (movingColor === 'white') {
      gs.castling &= ~(CASTLING.WHITE_KINGSIDE | CASTLING.WHITE_QUEENSIDE);
    } else {
      gs.castling &= ~(CASTLING.BLACK_KINGSIDE | CASTLING.BLACK_QUEENSIDE);
    }

    const fileDiff = (to & 7) - (from & 7);
    if (Math.abs(fileDiff) !== 2) return;

    this._moveCastlingRook(gs, u, from, fileDiff, movingColorIdx);
  }

  _moveCastlingRook(gs, u, kingFrom, fileDiff, colorIdx) {
    const rank = kingFrom >> 3;
    let rookFrom, rookTo;

    if (fileDiff > 0) {
      rookFrom = (rank << 3) | 7;
      rookTo   = (rank << 3) | 5;
    } else {
      rookFrom = (rank << 3);
      rookTo   = (rank << 3) | 3;
    }

    gs.zobristKey ^= PIECE_SQUARE_KEYS[colorIdx][PIECES.ROOK][rookFrom];
    gs.zobristKey ^= PIECE_SQUARE_KEYS[colorIdx][PIECES.ROOK][rookTo];
    this.bbPieces[colorIdx][PIECES.ROOK].clearBit(rookFrom).setBit(rookTo);
    this.bbSide[colorIdx].clearBit(rookFrom).setBit(rookTo);
    this.pieceList[rookFrom] = PIECES.NONE;
    this.pieceList[rookTo] = PIECES.ROOK;
    u.castleRookFrom = rookFrom;
    u.castleRookTo = rookTo;
  }

  _updateCastlingRights(gs, movingPiece, capturedPiece, from, to, movingColor) {
    if (movingPiece === PIECES.ROOK) {
      if (movingColor === 'white') {
        if (from === 0) gs.castling &= ~CASTLING.WHITE_QUEENSIDE;
        if (from === 7) gs.castling &= ~CASTLING.WHITE_KINGSIDE;
      } else {
        if (from === 56) gs.castling &= ~CASTLING.BLACK_QUEENSIDE;
        if (from === 63) gs.castling &= ~CASTLING.BLACK_KINGSIDE;
      }
    }
    if (capturedPiece === PIECES.ROOK) {
      if (to === 0)  gs.castling &= ~CASTLING.WHITE_QUEENSIDE;
      if (to === 7)  gs.castling &= ~CASTLING.WHITE_KINGSIDE;
      if (to === 56) gs.castling &= ~CASTLING.BLACK_QUEENSIDE;
      if (to === 63) gs.castling &= ~CASTLING.BLACK_KINGSIDE;
    }
  }

  _updateZobristEpAndCastling(gs, prevCastling, prevEpSquare) {
    if (prevEpSquare !== gs.enPassantSquare) {
      gs.zobristKey ^= EN_PASSANT_KEYS[getEnPassantZobristIndex(prevEpSquare)];
      gs.zobristKey ^= EN_PASSANT_KEYS[getEnPassantZobristIndex(gs.enPassantSquare)];
    }
    if (prevCastling !== gs.castling) {
      gs.zobristKey ^= CASTLING_KEYS[prevCastling];
      gs.zobristKey ^= CASTLING_KEYS[gs.castling];
    }
  }

  _flipSideToMove(gs, movingColor, oppositeColor) {
    gs.zobristKey ^= SIDE_KEYS[movingColor === 'white' ? 0 : 1];
    gs.zobristKey ^= SIDE_KEYS[oppositeColor === 'white' ? 0 : 1];
    gs.activeColor = oppositeColor;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // undoMove — ZERO ALLOCATIONS
  // Reads the frame written by makeMove and reverses every mutation.
  // ─────────────────────────────────────────────────────────────────────────
  undoMove() {
    if (this._undoPly === 0) return false;

    const u = this._undo[--this._undoPly];
    const gs = this.gameState;

    // ── Restore GameState scalars from snapshot ──
    // This replaces the old `this.gameState = this.history.pop()` — same
    // semantics, but we write into the existing object instead of swapping refs.
    gs.castling        = u.prevCastling;
    gs.enPassantSquare = u.prevEpSquare;
    gs.halfMoveClock   = u.prevHalfMove;
    gs.fullMoveCount   = u.prevFullMove;
    gs.zobristKey      = u.prevZobrist;
    gs.activeColor     = gs.activeColor === 'white' ? 'black' : 'white';

    const movingColor = gs.activeColor;   // now restored to the mover's color
    const oppositeColor = movingColor === 'white' ? 'black' : 'white';
    const movingColorIdx = colorToIndex(movingColor);
    const oppositeColorIdx = colorToIndex(oppositeColor);

    const { from, to, movingPiece, capturedPiece, promotionPiece,
            epCaptureSquare, castleRookFrom, castleRookTo } = u;

    // ── Remove piece from destination ──
    // If this was a promotion, the piece at `to` is the promoted piece.
    const pieceAtDest = promotionPiece || movingPiece;
    this.bbPieces[movingColorIdx][pieceAtDest].clearBit(to);
    this.bbSide[movingColorIdx].clearBit(to);

    // ── Restore moving piece at source ──
    // Promotions revert to pawn.
    const restoredPiece = promotionPiece ? PIECES.PAWN : movingPiece;
    this.bbPieces[movingColorIdx][restoredPiece].setBit(from);
    this.bbSide[movingColorIdx].setBit(from);
    this.pieceList[from] = restoredPiece;

    // ── Restore captured piece ──
    if (capturedPiece !== PIECES.NONE) {
      this.bbPieces[oppositeColorIdx][capturedPiece].setBit(to);
      this.bbSide[oppositeColorIdx].setBit(to);
      this.pieceList[to] = capturedPiece;
    } else {
      this.pieceList[to] = PIECES.NONE;
    }

    // ── Restore en-passant victim ──
    if (epCaptureSquare !== -1) {
      this.bbPieces[oppositeColorIdx][PIECES.PAWN].setBit(epCaptureSquare);
      this.bbSide[oppositeColorIdx].setBit(epCaptureSquare);
      this.pieceList[epCaptureSquare] = PIECES.PAWN;
    }

    // ── Restore castling rook ──
    if (castleRookFrom !== -1) {
      this.bbPieces[movingColorIdx][PIECES.ROOK].clearBit(castleRookTo).setBit(castleRookFrom);
      this.bbSide[movingColorIdx].clearBit(castleRookTo).setBit(castleRookFrom);
      this.pieceList[castleRookFrom] = PIECES.ROOK;
      this.pieceList[castleRookTo] = PIECES.NONE;
    }

    return true;
  }

  getOccupancy() {
    return this.bbSide[WHITE_IDX].or(this.bbSide[BLACK_IDX]);
  }

  // ─────────────────── FEN (unchanged) ───────────────────

  toFen() {
    let fen = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const sq = rank * 8 + file;
        const piece = this.pieceList[sq];
        if (piece === PIECES.NONE) { empty++; continue; }
        if (empty > 0) { fen += empty; empty = 0; }
        const isWhite = this.bbSide[WHITE_IDX].getBit(sq);
        const ch = ['K', 'Q', 'R', 'B', 'N', 'P'][piece];
        fen += isWhite ? ch : ch.toLowerCase();
      }
      if (empty > 0) fen += empty;
      if (rank > 0) fen += '/';
    }
    fen += ' ' + (this.gameState.activeColor === 'white' ? 'w' : 'b');
    let c = '';
    if (this.gameState.castling & CASTLING.WHITE_KINGSIDE)  c += 'K';
    if (this.gameState.castling & CASTLING.WHITE_QUEENSIDE) c += 'Q';
    if (this.gameState.castling & CASTLING.BLACK_KINGSIDE)  c += 'k';
    if (this.gameState.castling & CASTLING.BLACK_QUEENSIDE) c += 'q';
    fen += ' ' + (c || '-');
    fen += ' ' + (this.gameState.enPassantSquare !== -1
      ? indexToSquare(this.gameState.enPassantSquare) : '-');
    fen += ' ' + this.gameState.halfMoveClock;
    fen += ' ' + this.gameState.fullMoveCount;
    return fen;
  }

  static fromFen(fen) {
    const board = new Board();
    const parts = fen.split(' ');
    const rows = parts[0].split('/');

    for (let color = 0; color <= 1; color++) {
      board.bbSide[color] = new BitBoard();
      for (let p = PIECES.KING; p <= PIECES.PAWN; p++) {
        board.bbPieces[color][p] = new BitBoard();
      }
    }
    board.pieceList.fill(PIECES.NONE);

    const pieceMap = { K: PIECES.KING, Q: PIECES.QUEEN, R: PIECES.ROOK,
                       B: PIECES.BISHOP, N: PIECES.KNIGHT, P: PIECES.PAWN };
    for (let rank = 7; rank >= 0; rank--) {
      const row = rows[7 - rank];
      let file = 0;
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') { file += parseInt(ch); continue; }
        const isWhite = ch === ch.toUpperCase();
        const colorIdx = isWhite ? WHITE_IDX : BLACK_IDX;
        const piece = pieceMap[ch.toUpperCase()];
        const sq = rank * 8 + file;
        board.pieceList[sq] = piece;
        board.bbPieces[colorIdx][piece].setBit(sq);
        board.bbSide[colorIdx].setBit(sq);
        file++;
      }
    }

    board.gameState.activeColor = parts[1] === 'w' ? 'white' : 'black';
    board.gameState.castling = 0;
    if (parts[2] !== '-') {
      if (parts[2].includes('K')) board.gameState.castling |= CASTLING.WHITE_KINGSIDE;
      if (parts[2].includes('Q')) board.gameState.castling |= CASTLING.WHITE_QUEENSIDE;
      if (parts[2].includes('k')) board.gameState.castling |= CASTLING.BLACK_KINGSIDE;
      if (parts[2].includes('q')) board.gameState.castling |= CASTLING.BLACK_QUEENSIDE;
    }
    board.gameState.enPassantSquare = parts[3] !== '-' ? squareToIndex(parts[3]) : -1;
    board.gameState.halfMoveClock = parseInt(parts[4]) || 0;
    board.gameState.fullMoveCount = parseInt(parts[5]) || 1;
    board.gameState.zobristKey = computeZobristKey(board);

    return board;
  }
}

export default Board;