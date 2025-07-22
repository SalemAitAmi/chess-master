export const pieceIcons = {
  k: "fa-chess-king",
  q: "fa-chess-queen",
  r: "fa-chess-rook",
  b: "fa-chess-bishop",
  n: "fa-chess-knight",
  p: "fa-chess-pawn",
};

export const initialBoard = [
  ["br", "bn", "bb", "bq", "bk", "bb", "bn", "br"],
  ["bp", "bp", "bp", "bp", "bp", "bp", "bp", "bp"],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["wp", "wp", "wp", "wp", "wp", "wp", "wp", "wp"],
  ["wr", "wn", "wb", "wq", "wk", "wb", "wn", "wr"],
];

export const initialCastlingRights = {
  white: { kingSide: true, queenSide: true },
  black: { kingSide: true, queenSide: true },
};

export const initialKingMoved = { white: false, black: false };

export const initialRookMoved = {
  white: { a1: false, h1: false },
  black: { a8: false, h8: false },
};