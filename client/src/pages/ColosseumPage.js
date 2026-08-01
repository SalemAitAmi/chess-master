import { useState, useEffect, useCallback, useRef } from "react";
import { useEngine } from "../hooks/useEngine";
import ChessBoard from "../components/ChessBoard";
import GameOverModal from "../components/GameOverModal";
import GameInfoPanel from "../components/GameInfoPanel";
import MoveHistory from "../components/MoveHistory";
import CapturedPieces from "../components/CapturedPieces";
import { squareToIndex, indexToRowCol } from "../utils/bitboard";

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const DIFFICULTY_DEPTHS = { 1:4, 2:6, 3:8, 4:12 };
const DIFFICULTY_NAMES = { 1:'Rookie', 2:'Casual', 3:'Strategic', 4:'Master' };
const initialGameState = { fen:STARTING_FEN, turn:'white', fullmove:1, halfmove:0,
  status:'ongoing', winner:'none', incheck:false, eval:0, material_white:3900,
  material_black:3900, captured_white:[], captured_black:[], canundo:false, blunder:false, lastmove:null };

const ColosseumPage = ({ config, onBackToMenu }) => {
  const engine = useEngine();
  const [gameState, setGameState] = useState(initialGameState);
  const [moveHistory, setMoveHistory] = useState([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const mountedRef = useRef(true);
  const initRef = useRef(false);
  const moveInProgressRef = useRef(false);
  const runningRef = useRef(false);
  const roundTimerRef = useRef(null);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; runningRef.current = false; }; }, []);
  useEffect(() => { runningRef.current = running && !paused; }, [running, paused]);

  const getBotsForRound = (round) => {
    const swapped = round % 2 === 1;
    return { white: swapped ? config.blackBot : config.whiteBot, black: swapped ? config.whiteBot : config.blackBot };
  };
  const currentBots = getBotsForRound(currentRound);

  useEffect(() => {
    if (!engine.connected || initRef.current) return;
    const init = async () => {
      initRef.current = true;
      try { await engine.newGame(); const s = await engine.getGameState();
        if (s && mountedRef.current) { setGameState({...initialGameState,...s}); setMoveHistory([]); setInitialized(true); }
      } catch (e) { console.error('Init failed:',e); initRef.current = false; }
    };
    init();
  }, [engine.connected]);

  /* ── Single move — NO setPosition so the board keeps full undo history
       and the server can detect threefold / 50-move draws. ── */
  const makeOneMove = useCallback(async () => {
    if (!engine.connected || moveInProgressRef.current) return false;
    moveInProgressRef.current = true;
    try {
      const cur = await engine.getGameState();
      if (!cur || !mountedRef.current || cur.status !== 'ongoing') return false;
      const depth = DIFFICULTY_DEPTHS[cur.turn === 'white' ? currentBots.white : currentBots.black];
      const result = await engine.go({ depth });
      if (!mountedRef.current) return false;
      if (result?.move && result.move !== '(none)') {
        const ns = await engine.makeMove(result.move);
        if (ns && mountedRef.current) {
          setGameState(p => ({...p,...ns}));
          setMoveHistory(p => [...p, ns.lastmovesan ?? result.move]);
          return ns.status === 'ongoing';
        }
      }
      return false;
    } catch (e) { console.error('Colosseum move error:',e); return false; }
    finally { moveInProgressRef.current = false; }
  }, [engine.connected, engine.getGameState, engine.go, engine.makeMove, currentBots]);

  useEffect(() => {
    if (!initialized || !running || paused) return;
    if (gameState.status !== 'ongoing') return;
    if (moveInProgressRef.current) return;
    const doMove = async () => {
      if (!runningRef.current || !mountedRef.current) return;
      const canContinue = await makeOneMove();
      if (canContinue && runningRef.current && mountedRef.current) setTimeout(doMove, 200);
    };
    const timer = setTimeout(doMove, 200);
    return () => clearTimeout(timer);
  }, [initialized, running, paused, gameState.status, makeOneMove]);

  useEffect(() => () => clearTimeout(roundTimerRef.current), []);
  
  useEffect(() => {
    if (gameState.status === 'ongoing' || !running) return;
    const result = { round: currentRound + 1, winner: gameState.winner === 'none' ? 'draw' : gameState.winner,
      status: gameState.status, moves: moveHistory.length,
      whiteBot: currentBots.white, blackBot: currentBots.black };
    setResults(p => [...p, result]);
    if (currentRound + 1 >= config.maxRounds) { setRunning(false); runningRef.current = false; return; }
    roundTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      setCurrentRound(r => r + 1);
      try { await engine.newGame(); const ns = await engine.getGameState();
        if (ns && mountedRef.current) { setGameState({...initialGameState,...ns}); setMoveHistory([]); } }
      catch (e) { console.error('Failed to start next round:', e); }
    }, 2000);
    return () => clearTimeout(roundTimerRef.current);
  }, [gameState.status, running, currentRound, config.maxRounds, currentBots, moveHistory.length, engine.newGame, engine.getGameState]);

  const handleStart   = () => { setRunning(true); setPaused(false); };
  const handlePause   = () => setPaused(true);
  const handleResume  = () => setPaused(false);
  const handleStop    = () => { setRunning(false); runningRef.current = false; engine.stop(); };
  const handleRestart = useCallback(async () => {
    setCurrentRound(0); setResults([]); setRunning(false); runningRef.current = false; setPaused(false); moveInProgressRef.current = false;
    try { await engine.newGame(); const ns = await engine.getGameState();
      if (ns && mountedRef.current) { setGameState({...initialGameState,...ns}); setMoveHistory([]); } }
    catch (e) { console.error('Restart failed:',e); }
  }, [engine.newGame, engine.getGameState]);

  const lastMove = gameState.lastmove ? (() => { const f=squareToIndex(gameState.lastmove.slice(0,2)), t=squareToIndex(gameState.lastmove.slice(2,4)); return (f===-1||t===-1)?null:{from:indexToRowCol(f),to:indexToRowCol(t)}; })() : null;
  const whiteWins = results.filter(r=>r.winner==='white').length;
  const blackWins = results.filter(r=>r.winner==='black').length;
  const draws     = results.filter(r=>r.winner==='draw').length;

  if (!engine.connected) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900">
      <div className="text-white text-xl mb-4">Connecting to engine...</div>
      {engine.error && <div className="text-red-400 mb-4">{engine.error}</div>}
      <button onClick={engine.reconnect} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Retry</button>
      <button onClick={onBackToMenu} className="mt-4 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">Back to Menu</button>
    </div>);
  if (!initialized) return (<div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900"><div className="text-white text-xl">Initializing...</div></div>);

  const gameOver = gameState.status !== 'ongoing';
  const winner = (gameState.winner === 'none' || gameState.winner === 'draw') ? null : gameState.winner;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 relative font-sans p-4">
      <div className="absolute top-4 left-4"><button onClick={onBackToMenu} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm font-semibold">← Main Menu</button></div>
      <div className="mb-6 text-center">
        <h1 className="text-4xl font-bold text-white mb-2">⚔️ Colosseum ⚔️</h1>
        <div className="text-gray-400">Round {currentRound+1} / {config.maxRounds}</div>
        <div className="text-gray-500 text-sm mt-1">{DIFFICULTY_NAMES[currentBots.white]} (White) vs {DIFFICULTY_NAMES[currentBots.black]} (Black)</div>
      </div>

      <div className="flex gap-6 items-start">
        {/* Left panel — reuses the shared components */}
        <div className="space-y-4">
          <GameInfoPanel gameState={gameState} />
          <CapturedPieces capturedWhite={gameState.captured_white} capturedBlack={gameState.captured_black} />
          {/* Match score card */}
          <div className="bg-gray-800 rounded-lg p-4 shadow-lg w-64">
            <h3 className="text-lg font-bold text-white mb-4 border-b border-gray-600 pb-2">Match Score</h3>
            <div className="grid grid-cols-3 gap-4 text-center mb-4">
              <div><div className="text-2xl font-bold text-yellow-300">{whiteWins}</div><div className="text-xs text-gray-400">White</div></div>
              <div><div className="text-2xl font-bold text-gray-400">{draws}</div><div className="text-xs text-gray-400">Draw</div></div>
              <div><div className="text-2xl font-bold text-gray-300">{blackWins}</div><div className="text-xs text-gray-400">Black</div></div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">Status:</span>
                <span className={`font-bold ${running&&!paused?'text-green-400':'text-gray-400'}`}>{running?(paused?'Paused':'Running'):'Stopped'}</span></div>
            </div>
            {results.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-600">
                <h4 className="text-sm font-bold text-gray-300 mb-2">History</h4>
                <div className="max-h-40 overflow-y-auto space-y-1 text-xs move-history-scroll">
                  {results.map((r,i)=>(
                    <div key={i} className="flex justify-between text-gray-400">
                      <span>Round {r.round}</span>
                      <span className={r.winner==='white'?'text-yellow-300':r.winner==='black'?'text-gray-300':'text-gray-500'}>
                        {r.winner==='draw'?`Draw (${r.status})`:`${r.winner}`} ({r.moves})</span>
                    </div>))}
                </div>
              </div>)}
          </div>
        </div>

        {/* Board */}
        <div className="flex flex-col items-center">
          <ChessBoard fen={gameState.fen} selected={null} legalMoves={[]} lastMove={lastMove} onSquareClick={()=>{}} flipped={currentRound%2===1} disabled={true} />
          <div className="mt-6 flex gap-4">
            {!running ? <button onClick={handleStart} className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg text-lg font-semibold">{results.length>0?'Continue':'Start Match'}</button>
             : paused ? <button onClick={handleResume} className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg text-lg font-semibold">Resume</button>
             : <button onClick={handlePause} className="px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-lg font-semibold">Pause</button>}
            {running && <button onClick={handleStop} className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg text-lg font-semibold">Stop</button>}
            {!running && results.length>0 && <button onClick={handleRestart} className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-lg font-semibold">New Match</button>}
          </div>
        </div>

        {/* Right — move history (shared component) */}
        <MoveHistory history={moveHistory} />
      </div>

      {gameOver && running && (
        <div className="mt-4 px-6 py-3 bg-gray-700 rounded-lg text-center">
          <span className="text-xl font-bold text-white">
            {winner ? `${winner} wins!` : gameState.status === 'threefold' ? 'Draw — Threefold Repetition'
              : gameState.status === 'fifty_move' ? 'Draw — 50-Move Rule'
              : gameState.status === 'insufficient_material' ? 'Draw — Insufficient Material'
              : 'Draw!'}
          </span>
          <span className="ml-4 text-gray-400">Next round...</span>
        </div>)}

      {!running && results.length >= config.maxRounds && (
        <div className="mt-4 px-8 py-4 bg-purple-900 rounded-lg text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Match Complete!</h2>
          <div className="text-gray-300">Final: White {whiteWins} - {draws} - {blackWins} Black</div>
          <div className="text-lg font-bold mt-2 text-purple-300">{whiteWins>blackWins?'White Wins!':blackWins>whiteWins?'Black Wins!':'Draw!'}</div>
        </div>)}

      <GameOverModal gameOver={gameOver} winner={winner} status={gameState.status} onRestart={handleRestart} />
    </div>
  );
};
export default ColosseumPage;