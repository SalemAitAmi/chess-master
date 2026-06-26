import { useState, useEffect, useCallback, useRef } from "react";
import { useEngine } from "../hooks/useEngine";
import ChessBoard from "../components/ChessBoard";
import PromotionModal from "../components/PromotionModal";
import GameOverModal from "../components/GameOverModal";
import GameInfoPanel from "../components/GameInfoPanel";
import MoveHistory from "../components/MoveHistory";
import CapturedPieces from "../components/CapturedPieces";
import { indexToSquare, rowColToIndex, squareToIndex, indexToRowCol } from "../utils/bitboard";

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const DIFFICULTY_DEPTHS = { 1: 4, 2: 6, 3: 8, 4: 12 };
const DIFFICULTY_NAMES = { 1: 'Rookie', 2: 'Casual', 3: 'Strategic', 4: 'Master' };
const initialGameState = { fen:STARTING_FEN, turn:'white', fullmove:1, halfmove:0,
  status:'ongoing', winner:'none', incheck:false, eval:0, material_white:3900,
  material_black:3900, captured_white:[], captured_black:[], canundo:false, blunder:false, lastmove:null };

const VsComputerPage = ({ playerColor, difficulty, onBackToMenu }) => {
  const engine = useEngine();
  const [gameState, setGameState] = useState(initialGameState);
  const [moveHistory, setMoveHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [promotion, setPromotion] = useState(null);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [engineThinking, setEngineThinking] = useState(false);
  const [currentPlayerColor, setCurrentPlayerColor] = useState(playerColor);
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const mountedRef = useRef(true);
  const initRef = useRef(false);
  const engineMoveRef = useRef(false);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const isPlayerTurn = gameState.turn === currentPlayerColor;

  const updateGameState = useCallback((engineState, appendMove = null) => {
    if (!engineState) return;
    setGameState(prev => ({ ...prev, ...engineState }));
    if (appendMove) setMoveHistory(prev => [...prev, appendMove]);
  }, []);

  useEffect(() => {
    if (!engine.connected || initRef.current) return;
    const init = async () => {
      initRef.current = true;
      try {
        await engine.newGame();
        const state = await engine.getGameState();
        if (state && mountedRef.current) { setGameState({...initialGameState,...state}); setMoveHistory([]); setInitialized(true); }
      } catch (err) { console.error('Init failed:', err); initRef.current = false; }
    };
    init();
  }, [engine.connected]);

  /* ── Engine move — NO setPosition, board keeps full history ── */
  const makeEngineMove = useCallback(async () => {
    if (!engine.connected || engineMoveRef.current) return;
    engineMoveRef.current = true;
    setEngineThinking(true);
    try {
      const currentState = await engine.getGameState();
      if (!currentState || !mountedRef.current || currentState.status !== 'ongoing') {
        engineMoveRef.current = false; setEngineThinking(false); return;
      }
      const result = await engine.go({ depth: DIFFICULTY_DEPTHS[difficulty] });
      if (!mountedRef.current) return;
      if (result?.move && result.move !== '(none)') {
        const newState = await engine.makeMove(result.move);
        if (newState && mountedRef.current) updateGameState(newState, result.move);
      }
    } catch (err) { console.error('Engine move error:', err); }
    finally { if (mountedRef.current) setEngineThinking(false); engineMoveRef.current = false; }
  }, [engine.connected, engine.getGameState, engine.go, engine.makeMove, difficulty, updateGameState]);

  useEffect(() => {
    if (!initialized || !engine.connected) return;
    if (gameState.status !== 'ongoing') return;
    if (isPlayerTurn || engineThinking || loading) return;
    if (engineMoveRef.current) return;
    const timer = setTimeout(makeEngineMove, 500);
    return () => clearTimeout(timer);
  }, [initialized, engine.connected, gameState.status, gameState.turn, isPlayerTurn, engineThinking, loading, makeEngineMove]);

  const fetchLegalMoves = useCallback(async (row, col) => {
    if (!engine.connected) return [];
    const sq = indexToSquare(rowColToIndex(row, col));
    try { const r = await engine.getLegalMoves(sq); return r?.moves||[]; } catch { return []; }
  }, [engine.connected, engine.getLegalMoves]);

  const handleSquareClick = useCallback(async (row, col) => {
    if (gameState.status !== 'ongoing' || promotion || loading) return;
    if (!isPlayerTurn || engineThinking || !engine.connected) return;
    const clickedSquare = indexToSquare(rowColToIndex(row, col));
    if (selected) {
      const [selRow, selCol] = selected;
      const fromSquare = indexToSquare(rowColToIndex(selRow, selCol));
      const moveStr = fromSquare + clickedSquare;
      const isValidMove = legalMoves.some(m => m === moveStr || m.startsWith(moveStr));
      if (isValidMove) {
        const promoMoves = legalMoves.filter(m => m.startsWith(moveStr) && m.length > 4);
        if (promoMoves.length > 0) { setPromotion({ from:fromSquare, to:clickedSquare, color:gameState.turn==='white'?'w':'b' }); return; }
        setLoading(true);
        try { const ns = await engine.makeMove(moveStr); if (ns && mountedRef.current) { updateGameState(ns, moveStr); setSelected(null); setLegalMoves([]); } }
        catch (e) { console.error('Move failed:', e); }
        setLoading(false); return;
      }
      const moves = await fetchLegalMoves(row, col);
      if (moves.length > 0) { setSelected([row,col]); setLegalMoves(moves); } else { setSelected(null); setLegalMoves([]); }
    } else {
      const moves = await fetchLegalMoves(row, col);
      if (moves.length > 0) { setSelected([row,col]); setLegalMoves(moves); }
    }
  }, [selected, legalMoves, gameState.status, gameState.turn, promotion, loading, isPlayerTurn, engineThinking, engine.connected, engine.makeMove, fetchLegalMoves, updateGameState]);

  const handlePromotion = useCallback(async (pieceType) => {
    if (!promotion || !engine.connected) return;
    const moveStr = promotion.from + promotion.to + pieceType;
    setLoading(true);
    try { const ns = await engine.makeMove(moveStr); if (ns && mountedRef.current) { updateGameState(ns, moveStr); setSelected(null); setLegalMoves([]); setPromotion(null); } }
    catch (e) { console.error('Promotion failed:', e); }
    setLoading(false);
  }, [promotion, engine.connected, engine.makeMove, updateGameState]);

  const handleUndo = useCallback(async () => {
    if (!gameState.canundo || !engine.connected || loading || engineThinking) return;
    setLoading(true);
    try {
      let ns = await engine.undoMove(); let undoCount = 1;
      if (ns?.canundo) { ns = await engine.undoMove(); undoCount = 2; }
      if (ns && mountedRef.current) { setMoveHistory(p=>p.slice(0,-undoCount)); updateGameState(ns); setSelected(null); setLegalMoves([]); }
    } catch (e) { console.error('Undo failed:', e); }
    setLoading(false);
  }, [gameState.canundo, loading, engineThinking, engine.connected, engine.undoMove, updateGameState]);

  const handleSurrender = useCallback(() => {
    setGameState(p => ({...p, status:'resignation', winner:currentPlayerColor==='white'?'black':'white'}));
  }, [currentPlayerColor]);

  const handleRestart = useCallback(async () => {
    if (!engine.connected) return;
    const newColor = currentPlayerColor === 'white' ? 'black' : 'white';
    setCurrentPlayerColor(newColor); setGamesPlayed(p=>p+1);
    initRef.current = false; engineMoveRef.current = false;
    setLoading(true);
    try { await engine.newGame(); const ns = await engine.getGameState();
      if (ns && mountedRef.current) { setGameState({...initialGameState,...ns}); setMoveHistory([]); setSelected(null); setLegalMoves([]); setPromotion(null); setInitialized(true); } }
    catch (e) { console.error('Restart failed:', e); }
    setLoading(false);
  }, [currentPlayerColor, engine.connected, engine.newGame, engine.getGameState]);

  const lastMove = gameState.lastmove ? (() => { const f=squareToIndex(gameState.lastmove.slice(0,2)), t=squareToIndex(gameState.lastmove.slice(2,4)); return (f===-1||t===-1)?null:{from:indexToRowCol(f),to:indexToRowCol(t)}; })() : null;
  const selectedWithMoves = selected ? { row:selected[0], col:selected[1], moves:legalMoves.map(m=>{const i=squareToIndex(m.slice(2,4));return i!==-1?indexToRowCol(i):null;}).filter(Boolean) } : null;
  const gameOver = gameState.status !== 'ongoing';
  const winner = gameState.winner === 'none' ? null : gameState.winner;

  if (!engine.connected) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900">
      <div className="text-white text-xl mb-4">Connecting to engine...</div>
      {engine.error && <div className="text-red-400 mb-4">{engine.error}</div>}
      <button onClick={engine.reconnect} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Retry</button>
      <button onClick={onBackToMenu} className="mt-4 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">Back to Menu</button>
    </div>);
  if (!initialized) return (<div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900"><div className="text-white text-xl">Initializing game...</div></div>);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 relative font-sans">
      <div className="absolute top-4 left-4"><button onClick={onBackToMenu} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm font-semibold">← Main Menu</button></div>
      <div className="mb-6 text-center">
        <h1 className="text-4xl font-bold text-white mb-2">VS Computer</h1>
        <div className="text-gray-400">{DIFFICULTY_NAMES[difficulty]} • Playing as {currentPlayerColor}{gamesPlayed>0&&` • Game #${gamesPlayed+1}`}</div>
      </div>
      <div className="flex gap-6 items-start">
        <div className="space-y-4"><GameInfoPanel gameState={gameState} /><CapturedPieces capturedWhite={gameState.captured_white} capturedBlack={gameState.captured_black} /></div>
        <div className="flex flex-col items-center">
          {engineThinking && <div className="mb-4 px-4 py-2 bg-gray-700 rounded-lg text-gray-300 animate-pulse">🤔 {DIFFICULTY_NAMES[difficulty]} is thinking...</div>}
          <ChessBoard fen={gameState.fen} selected={selectedWithMoves} legalMoves={legalMoves} lastMove={lastMove} onSquareClick={handleSquareClick} flipped={currentPlayerColor==='black'} disabled={loading||engineThinking||gameOver||!isPlayerTurn} />
          <div className="mt-6 flex gap-4">
            {!gameOver && !promotion && (<>
              <button onClick={handleUndo} disabled={!gameState.canundo||loading||engineThinking} className={`px-6 py-3 rounded-lg text-lg font-semibold ${gameState.canundo&&!loading&&!engineThinking?'bg-blue-600 hover:bg-blue-700 text-white':'bg-gray-600 cursor-not-allowed text-gray-400'}`}>↶ Undo</button>
              <button onClick={handleSurrender} disabled={loading||engineThinking} className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg text-lg font-semibold">⚑ Surrender</button>
            </>)}
          </div>
        </div>
        <MoveHistory history={moveHistory} />
      </div>
      <PromotionModal promotion={promotion} onPromotion={handlePromotion} />
      <GameOverModal gameOver={gameOver} winner={winner} status={gameState.status} onRestart={handleRestart} />
    </div>
  );
};
export default VsComputerPage;