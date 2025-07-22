import { isWhite, isBlack, deepCopyBoard } from "./chessUtils";

export const isInCheck = (board, color) => {
  let kingPos;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === `${color[0]}k`) {
        kingPos = [r, c];
      }
    }
  }
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (
        board[r][c] &&
        (color === "white" ? isBlack(board[r][c]) : isWhite(board[r][c]))
      ) {
        if (
          getValidMoves(r, c, board, false, null, {}, {}, {}).some(
            ([mr, mc]) => mr === kingPos[0] && mc === kingPos[1]
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
};

export const getValidMoves = (
  row,
  col,
  currentBoard,
  checkCastling = true,
  enPassantTarget,
  castlingRights,
  kingMoved,
  rookMoved
) => {
  const piece = currentBoard[row][col];
  if (!piece) return [];
  const pieceType = piece[1];
  const moves = [];

  const addMove = (r, c) => {
    if (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const target = currentBoard[r][c];
      if (
        !target ||
        (isWhite(piece) && isBlack(target)) ||
        (isBlack(piece) && isWhite(target))
      ) {
        moves.push([r, c]);
      }
    }
  };

  const addLineMoves = (dirs) => {
    dirs.forEach(([dr, dc]) => {
      let r = row + dr,
        c = col + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const target = currentBoard[r][c];
        if (!target) {
          moves.push([r, c]);
        } else {
          if (
            (isWhite(piece) && isBlack(target)) ||
            (isBlack(piece) && isWhite(target))
          ) {
            moves.push([r, c]);
          }
          break;
        }
        r += dr;
        c += dc;
      }
    });
  };

  switch (pieceType) {
    case "p":
      if (isWhite(piece)) {
        if (row === 6 && !currentBoard[5][col] && !currentBoard[4][col])
          moves.push([4, col]);
        if (row > 0 && !currentBoard[row - 1][col])
          moves.push([row - 1, col]);
        if (row > 0 && col > 0 && isBlack(currentBoard[row - 1][col - 1]))
          moves.push([row - 1, col - 1]);
        if (row > 0 && col < 7 && isBlack(currentBoard[row - 1][col + 1]))
          moves.push([row - 1, col + 1]);
        // En passant
        if (row === 3 && enPassantTarget) {
          if (enPassantTarget[0] === 2 && enPassantTarget[1] === col - 1) {
            moves.push([2, col - 1]);
          }
          if (enPassantTarget[0] === 2 && enPassantTarget[1] === col + 1) {
            moves.push([2, col + 1]);
          }
        }
      } else {
        if (row === 1 && !currentBoard[2][col] && !currentBoard[3][col])
          moves.push([3, col]);
        if (row < 7 && !currentBoard[row + 1][col])
          moves.push([row + 1, col]);
        if (row < 7 && col > 0 && isWhite(currentBoard[row + 1][col - 1]))
          moves.push([row + 1, col - 1]);
        if (row < 7 && col < 7 && isWhite(currentBoard[row + 1][col + 1]))
          moves.push([row + 1, col + 1]);
        // En passant
        if (row === 4 && enPassantTarget) {
          if (enPassantTarget[0] === 5 && enPassantTarget[1] === col - 1) {
            moves.push([5, col - 1]);
          }
          if (enPassantTarget[0] === 5 && enPassantTarget[1] === col + 1) {
            moves.push([5, col + 1]);
          }
        }
      }
      break;
    case "r":
      addLineMoves([
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]);
      break;
    case "n":
      [
        [2, 1],
        [2, -1],
        [-2, 1],
        [-2, -1],
        [1, 2],
        [1, -2],
        [-1, 2],
        [-1, -2],
      ].forEach(([dr, dc]) => addMove(row + dr, col + dc));
      break;
    case "b":
      addLineMoves([
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]);
      break;
    case "q":
      addLineMoves([
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]);
      break;
    case "k":
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].forEach(([dr, dc]) => addMove(row + dr, col + dc));

      // Castling
      if (checkCastling && castlingRights && kingMoved) {
        const color = isWhite(piece) ? "white" : "black";
        const backRank = isWhite(piece) ? 7 : 0;
        
        console.log(`Checking castling for ${color}:`, {
          kingMoved: kingMoved[color],
          castlingRights: castlingRights[color],
          kingPosition: [row, col],
          inCheck: isInCheck(currentBoard, color)
        });

        if (!kingMoved[color] && !isInCheck(currentBoard, color)) {
          // King-side castling
          if (
            castlingRights[color] && 
            castlingRights[color].kingSide &&
            !currentBoard[backRank][5] &&
            !currentBoard[backRank][6] &&
            currentBoard[backRank][7] === `${color[0]}r`
          ) {
            console.log(`${color} king-side castling is structurally valid`);
            
            // Check if squares king passes through are not under attack
            const testBoard1 = deepCopyBoard(currentBoard);
            testBoard1[backRank][5] = piece;
            testBoard1[backRank][4] = "";
            
            const testBoard2 = deepCopyBoard(currentBoard);
            testBoard2[backRank][6] = piece;
            testBoard2[backRank][4] = "";
            
            const square1Safe = !isInCheck(testBoard1, color);
            const square2Safe = !isInCheck(testBoard2, color);
            
            console.log(`${color} king-side castling path safe:`, { square1Safe, square2Safe });
            
            if (square1Safe && square2Safe) {
              moves.push([backRank, 6]);
            }
          }
          
          // Queen-side castling
          if (
            castlingRights[color] && 
            castlingRights[color].queenSide &&
            !currentBoard[backRank][1] &&
            !currentBoard[backRank][2] &&
            !currentBoard[backRank][3] &&
            currentBoard[backRank][0] === `${color[0]}r`
          ) {
            console.log(`${color} queen-side castling is structurally valid`);
            
            // Check if squares king passes through are not under attack
            const testBoard1 = deepCopyBoard(currentBoard);
            testBoard1[backRank][3] = piece;
            testBoard1[backRank][4] = "";
            
            const testBoard2 = deepCopyBoard(currentBoard);
            testBoard2[backRank][2] = piece;
            testBoard2[backRank][4] = "";
            
            const square1Safe = !isInCheck(testBoard1, color);
            const square2Safe = !isInCheck(testBoard2, color);
            
            console.log(`${color} queen-side castling path safe:`, { square1Safe, square2Safe });
            
            if (square1Safe && square2Safe) {
              moves.push([backRank, 2]);
            }
          }
        }
      }
      break;
  }
  return moves;
};

export const simulateMove = (
  fromRow,
  fromCol,
  toRow,
  toCol,
  currentBoard,
  enPassantTarget
) => {
  const newBoard = deepCopyBoard(currentBoard);
  const piece = newBoard[fromRow][fromCol];

  // Handle en passant capture
  if (piece[1] === "p" && enPassantTarget) {
    if (
      isWhite(piece) &&
      toRow === 2 &&
      toCol === enPassantTarget[1] &&
      fromRow === 3
    ) {
      newBoard[3][toCol] = "";
    }
    if (
      isBlack(piece) &&
      toRow === 5 &&
      toCol === enPassantTarget[1] &&
      fromRow === 4
    ) {
      newBoard[4][toCol] = "";
    }
  }

  // Handle castling
  if (piece[1] === "k") {
    const isWhiteKing = isWhite(piece);
    const backRank = isWhiteKing ? 7 : 0;

    // King-side castling
    if (fromCol === 4 && toCol === 6) {
      console.log(`Executing ${isWhiteKing ? 'white' : 'black'} king-side castling`);
      newBoard[backRank][5] = newBoard[backRank][7];
      newBoard[backRank][7] = "";
    }
    // Queen-side castling
    if (fromCol === 4 && toCol === 2) {
      console.log(`Executing ${isWhiteKing ? 'white' : 'black'} queen-side castling`);
      newBoard[backRank][3] = newBoard[backRank][0];
      newBoard[backRank][0] = "";
    }
  }

  if (
    piece[1] === "p" &&
    ((isWhite(piece) && toRow === 0) || (isBlack(piece) && toRow === 7))
  ) {
    return { board: newBoard, needsPromotion: true };
  }

  newBoard[toRow][toCol] = piece;
  newBoard[fromRow][fromCol] = "";
  return { board: newBoard, needsPromotion: false };
};

export const hasValidMoves = (
  color,
  currentBoard,
  enPassantTarget,
  castlingRights,
  kingMoved,
  rookMoved
) => {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = currentBoard[r][c];
      if (
        piece &&
        ((color === "white" && isWhite(piece)) ||
          (color === "black" && isBlack(piece)))
      ) {
        const moves = getValidMoves(
          r,
          c,
          currentBoard,
          true,
          enPassantTarget,
          castlingRights,
          kingMoved,
          rookMoved
        );
        for (const [toRow, toCol] of moves) {
          const { board: simulatedBoard } = simulateMove(
            r,
            c,
            toRow,
            toCol,
            currentBoard,
            enPassantTarget
          );
          if (!isInCheck(simulatedBoard, color)) {
            return true;
          }
        }
      }
    }
  }
  return false;
};