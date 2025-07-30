import { isWhite, isBlack } from "../utils/chessUtils";
import { getValidMoves, simulateMove, isInCheck, hasValidMoves } from "../utils/chessLogic";

export const createGameHandlers = (gameState) => {
  const {
    board,
    setBoard,
    selected,
    setSelected,
    turn,
    setTurn,
    setGameOver,
    setWinner,
    setLastMove,
    enPassantTarget,
    setEnPassantTarget,
    promotion,
    setPromotion,
    castlingRights,
    setCastlingRights,
    kingMoved,
    setKingMoved,
    rookMoved,
    setRookMoved,
    gameMode,
    currentBot,
    setIsThinking,
    resetGame,
    resetToMenu,
  } = gameState;

  const handlePromotion = (pieceType) => {
    if (!promotion) return;

    const newBoard = [...promotion.board];
    const { row, col, color } = promotion;
    newBoard[row][col] = `${color}${pieceType}`;

    setBoard(newBoard);
    setTurn(color === "w" ? "black" : "white");
    setSelected(null);
    setPromotion(null);

    const nextTurnColor = color === "w" ? "black" : "white";
    const opponentInCheck = isInCheck(newBoard, nextTurnColor);
    const opponentHasMoves = hasValidMoves(
      nextTurnColor,
      newBoard,
      enPassantTarget,
      castlingRights,
      kingMoved,
      rookMoved
    );

    if (opponentInCheck && !opponentHasMoves) {
      setGameOver(true);
      setWinner(color === "w" ? "White" : "Black");
    } else if (gameMode === 'bot' && nextTurnColor === currentBot.color) {
      setTimeout(() => handleBotMove(newBoard, nextTurnColor), 500);
    }
  };

  const handleBotMove = async (currentBoard, botColor) => {
    if (!currentBot || botColor !== currentBot.color) return;

    setIsThinking(true);
    
    try {
      const botMove = await currentBot.selectMove(
        currentBoard,
        enPassantTarget,
        castlingRights,
        kingMoved,
        rookMoved
      );

      if (botMove) {
        const [fromRow, fromCol] = botMove.from;
        const [toRow, toCol] = botMove.to;
        
        const { board: newBoard, needsPromotion } = simulateMove(
          fromRow,
          fromCol,
          toRow,
          toCol,
          currentBoard,
          enPassantTarget
        );

        const piece = currentBoard[fromRow][fromCol];
        
        updateCastlingRights(piece, fromRow, fromCol, botColor);

        if (needsPromotion) {
          newBoard[toRow][toCol] = `${botColor[0]}q`;
        }

        if (piece[1] === "p" && Math.abs(fromRow - toRow) === 2) {
          setEnPassantTarget([toRow + (isWhite(piece) ? 1 : -1), toCol]);
        } else {
          setEnPassantTarget(null);
        }

        setBoard(newBoard);
        setLastMove({ from: [fromRow, fromCol], to: [toRow, toCol] });
        setTurn("white");
        setSelected(null);
        setIsThinking(false);

        // Track the bot's move for opening book
        if (currentBot.trackMove) {
          currentBot.trackMove(botMove);
        }

        const opponentInCheck = isInCheck(newBoard, "white");
        const opponentHasMoves = hasValidMoves(
          "white",
          newBoard,
          null,
          castlingRights,
          kingMoved,
          rookMoved
        );

        if (opponentInCheck && !opponentHasMoves) {
          setGameOver(true);
          setWinner(currentBot.name);
        } else if (!opponentHasMoves) {
          // Stalemate
          setGameOver(true);
          setWinner("Draw");
        }
      } else {
        setIsThinking(false);
      }
    } catch (error) {
      console.error("Bot move error:", error);
      setIsThinking(false);
    }
  };

  const updateCastlingRights = (piece, fromRow, fromCol, color) => {
    if (piece[1] === "k") {
      setKingMoved((prev) => ({
        ...prev,
        [color]: true,
      }));
      setCastlingRights((prev) => ({
        ...prev,
        [color]: {
          kingSide: false,
          queenSide: false,
        },
      }));
      console.log(`${color} king moved, castling rights removed`);
    }
    if (piece[1] === "r") {
      const backRank = color === "white" ? 7 : 0;
      if (fromRow === backRank) {
        if (fromCol === 0) {
          setRookMoved((prev) => ({
            ...prev,
            [color]: { ...prev[color], a1: color === "white", a8: color === "black" },
          }));
          setCastlingRights((prev) => ({
            ...prev,
            [color]: { ...prev[color], queenSide: false },
          }));
          console.log(`${color} queen-side rook moved, queen-side castling removed`);
        }
        if (fromCol === 7) {
          setRookMoved((prev) => ({
            ...prev,
            [color]: { ...prev[color], h1: color === "white", h8: color === "black" },
          }));
          setCastlingRights((prev) => ({
            ...prev,
            [color]: { ...prev[color], kingSide: false },
          }));
          console.log(`${color} king-side rook moved, king-side castling removed`);
        }
      }
    }
  };

  const handleClick = (row, col) => {
    if (promotion) return;
    
    if (gameMode === 'bot' && turn === currentBot.color) return;

    const piece = board[row][col];
    const isWhiteTurn = turn === "white";

    // If no piece is selected
    if (!selected) {
      if (
        piece &&
        ((isWhiteTurn && isWhite(piece)) || (!isWhiteTurn && isBlack(piece)))
      ) {
        const moves = getValidMoves(
          row,
          col,
          board,
          true,
          enPassantTarget,
          castlingRights,
          kingMoved,
          rookMoved
        ).filter(([toRow, toCol]) => {
          const { board: simulatedBoard } = simulateMove(
            row,
            col,
            toRow,
            toCol,
            board,
            enPassantTarget
          );
          return !isInCheck(simulatedBoard, turn);
        });

        if (moves.length > 0) {
          setSelected({ row, col, moves });
        }
      }
      return;
    }

    // If a piece is already selected
    const { row: fromRow, col: fromCol, moves } = selected;
    
    // Check if clicking on another piece of the same color (single-click piece switch)
    if (
      piece &&
      ((isWhiteTurn && isWhite(piece)) || (!isWhiteTurn && isBlack(piece))) &&
      (row !== fromRow || col !== fromCol)
    ) {
      const moves = getValidMoves(
        row,
        col,
        board,
        true,
        enPassantTarget,
        castlingRights,
        kingMoved,
        rookMoved
      ).filter(([toRow, toCol]) => {
        const { board: simulatedBoard } = simulateMove(
          row,
          col,
          toRow,
          toCol,
          board,
          enPassantTarget
        );
        return !isInCheck(simulatedBoard, turn);
      });

      if (moves.length > 0) {
        setSelected({ row, col, moves });
      } else {
        setSelected(null);
      }
      return;
    }

    // Check if it's a valid move
    const validMove = moves.some(([r, c]) => r === row && c === col);

    if (validMove) {
      const { board: newBoard, needsPromotion } = simulateMove(
        fromRow,
        fromCol,
        row,
        col,
        board,
        enPassantTarget
      );
      const piece = board[fromRow][fromCol];

      updateCastlingRights(piece, fromRow, fromCol, isWhiteTurn ? "white" : "black");

      if (needsPromotion) {
        setPromotion({
          board: newBoard,
          row,
          col,
          color: isWhite(piece) ? "w" : "b",
        });
        setLastMove({ from: [fromRow, fromCol], to: [row, col] });
        setEnPassantTarget(null);
        return;
      }

      if (piece[1] === "p" && Math.abs(fromRow - row) === 2) {
        setEnPassantTarget([row + (isWhite(piece) ? 1 : -1), col]);
      } else {
        setEnPassantTarget(null);
      }

      setBoard(newBoard);
      setLastMove({ from: [fromRow, fromCol], to: [row, col] });
      setTurn(isWhiteTurn ? "black" : "white");
      setSelected(null);

      // Track move for bot's opening book
      if (gameMode === 'bot' && currentBot.trackMove) {
        const move = { from: [fromRow, fromCol], to: [row, col], piece: piece };
        currentBot.trackMove(move);
      }

      const nextTurnColor = isWhiteTurn ? "black" : "white";
      const opponentInCheck = isInCheck(newBoard, nextTurnColor);
      const opponentHasMoves = hasValidMoves(
        nextTurnColor,
        newBoard,
        null,
        castlingRights,
        kingMoved,
        rookMoved
      );

      if (opponentInCheck && !opponentHasMoves) {
        setGameOver(true);
        setWinner(isWhiteTurn ? "White" : "Black");
      } else if (!opponentHasMoves) {
        // Stalemate
        setGameOver(true);
        setWinner("Draw");
      } else if (gameMode === 'bot' && nextTurnColor === currentBot.color) {
        setTimeout(() => handleBotMove(newBoard, nextTurnColor), 500);
      }
    } else {
      // Deselect if clicking elsewhere
      setSelected(null);
    }
  };

  const handleSurrender = () => {
    setGameOver(true);
    if (gameMode === 'bot') {
      setWinner(turn === "white" ? currentBot.name : "White");
    } else {
      setWinner(turn === "white" ? "Black" : "White");
    }
  };

  const handleRestart = () => {
    if (currentBot && currentBot.reset) {
      currentBot.reset();
    }
    resetGame();
  };

  const handleBackToMenu = () => {
    if (currentBot && currentBot.reset) {
      currentBot.reset();
    }
    resetToMenu();
  };

  return {
    handleClick,
    handlePromotion,
    handleSurrender,
    handleRestart,
    handleBackToMenu,
  };
};
