export const isWhite = (piece) => piece.startsWith("w");
export const isBlack = (piece) => piece.startsWith("b");
export const deepCopyBoard = (board) => board.map((row) => [...row]);