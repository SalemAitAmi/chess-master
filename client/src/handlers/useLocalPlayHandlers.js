import { useEffect, useRef, useCallback } from "react";
import { getPieceAt } from "../utils/chessUtils";
import { getValidMoves, simulateMove, isInCheck, hasValidMoves } from "../utils/chessLogic";
import { PIECES, SQUARE_NAMES } from "../constants/gameConstants";
import { rowColToIndex, indexToRowCol } from "../utils/bitboard";

export const useLocalPlayHandlers = (gameState, setSelectedWithMoves) => {
  const {
    boardObj,
    setBoard,
    selected,
    setSelected,
    turn,
    gameOver,
    setGameOver,
    setWinner,
    setLastMove,
    promotion,
    setPromotion,
    resetGame,
  } = gameState;

  const prevSelectedRef = useRef();

  useEffect(() => {
    if (prevSelectedRef.current === selected) {
      return;
    }
    prevSelectedRef.current = selected;
    
    if (selected) {
      const [row, col] = selected;
      const piece = getPieceAt(boardObj, row, col);
      
      if (piece) {
        const moves = getValidMoves(row, col, boardObj);
        const currentColor = boardObj.gameState.active_color;
        const validMoves = moves.filter(([toRow, toCol]) => {
          const result = simulateMove(row, col, toRow, toCol, boardObj);
          return !isInCheck(result.board, currentColor);
        });
        
        setSelectedWithMoves({
          row,
          col,
          moves: validMoves
        });
      }
    } else {
      setSelectedWithMoves(null);
    }
  }, [selected, boardObj, setSelectedWithMoves]);

  const handlePromotion = useCallback((pieceType) => {
    if (!promotion) return;

    const { fromRow, fromCol, toRow, toCol, board: promotionBoard } = promotion;
    const fromIndex = rowColToIndex(fromRow, fromCol);
    const toIndex = rowColToIndex(toRow, toCol);
    
    const pieceMap = {
      'q': PIECES.QUEEN,
      'r': PIECES.ROOK,
      'b': PIECES.BISHOP,
      'n': PIECES.KNIGHT
    };
    
    const newBoard = promotionBoard.clone();
    newBoard.makeMove(fromIndex, toIndex, pieceMap[pieceType]);

    setBoard(newBoard);
    setSelected(null);
    setPromotion(null);

    const nextTurnColor = newBoard.gameState.active_color;
    const opponentInCheck = isInCheck(newBoard, nextTurnColor);
    const opponentHasMoves = hasValidMoves(nextTurnColor, newBoard);

    if (!opponentHasMoves) {
      setGameOver(true);
      if (opponentInCheck) {
        setWinner(nextTurnColor === "white" ? "black" : "white");
      } else {
        setWinner("draw");
      }
    }
  }, [promotion, setBoard, setSelected, setPromotion, setGameOver, setWinner]);

  const makeMove = useCallback((fromRow, fromCol, toRow, toCol) => {
    const piece = getPieceAt(boardObj, fromRow, fromCol);
    if (!piece) return;

    const currentColor = boardObj.gameState.active_color;
    const result = simulateMove(fromRow, fromCol, toRow, toCol, boardObj);

    if (result.needsPromotion) {
      setPromotion({
        board: result.board,
        fromRow,
        fromCol,
        toRow,
        toCol,
        color: piece.color === "white" ? "w" : "b"
      });
    } else {
      const fromIndex = rowColToIndex(fromRow, fromCol);
      const toIndex = rowColToIndex(toRow, toCol);
      
      const newBoard = boardObj.clone();
      newBoard.makeMove(fromIndex, toIndex);
      
      setBoard(newBoard);
      setLastMove({ from: [fromRow, fromCol], to: [toRow, toCol] });
      setSelected(null);

      const nextTurnColor = newBoard.gameState.active_color;
      const opponentInCheck = isInCheck(newBoard, nextTurnColor);
      const opponentHasMoves = hasValidMoves(nextTurnColor, newBoard);

      if (!opponentHasMoves) {
        setGameOver(true);
        if (opponentInCheck) {
          setWinner(currentColor);
        } else {
          setWinner("draw");
        }
      }
    }
  }, [boardObj, setBoard, setLastMove, setSelected, setPromotion, setGameOver, setWinner]);

  const handleSquareClick = useCallback((row, col) => {
    if (gameOver || promotion) return;
    
    const piece = getPieceAt(boardObj, row, col);
    const currentColor = boardObj.gameState.active_color;

    if (selected) {
      const [selectedRow, selectedCol] = selected;
      const selectedPiece = getPieceAt(boardObj, selectedRow, selectedCol);
      
      if (selectedPiece && selectedPiece.color === currentColor) {
        const moves = getValidMoves(selectedRow, selectedCol, boardObj, true);
        const validMove = moves.find(([r, c]) => r === row && c === col);
        
        if (validMove) {
          const result = simulateMove(selectedRow, selectedCol, row, col, boardObj);
          
          if (!isInCheck(result.board, currentColor)) {
            makeMove(selectedRow, selectedCol, row, col);
            return;
          }
        }
      }
      
      if (piece && piece.color === currentColor) {
        setSelected([row, col]);
      } else {
        setSelected(null);
      }
    } else {
      if (piece && piece.color === currentColor) {
        setSelected([row, col]);
      }
    }
  }, [gameOver, promotion, boardObj, selected, setSelected, makeMove]);

  const handleUndo = useCallback(() => {
    if (boardObj.canUndo()) {
      boardObj.undoMove();
      setBoard(boardObj.clone());
      setSelected(null);
      
      const lastMove = boardObj.getLastMove();
      if (lastMove) {
        const fromRowCol = indexToRowCol(lastMove.from);
        const toRowCol = indexToRowCol(lastMove.to);
        setLastMove({ from: fromRowCol, to: toRowCol });
      } else {
        setLastMove(null);
      }
    }
  }, [boardObj, setBoard, setSelected, setLastMove]);

  const handleSurrender = useCallback(() => {
    const gameWinner = turn === "white" ? "black" : "white";
    setWinner(gameWinner);
    setGameOver(true);
  }, [turn, setWinner, setGameOver]);

  const handleRestart = useCallback(() => {
    resetGame();
  }, [resetGame]);

  return {
    handleSquareClick,
    handlePromotion,
    handleUndo,
    handleSurrender,
    handleRestart,
  };
};