import { useState, useEffect, useCallback, useRef } from "react";
import { useEngine } from "../hooks/useEngine";
import ChessBoard from "../components/ChessBoard";
import { indexToSquare, squareToIndex, indexToRowCol } from "../utils/bitboard";

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const DIFFICULTY_DEPTHS = { 1: 4, 2: 6, 3: 8, 4: 12 };
const DIFFICULTY_NAMES = { 1: 'Rookie', 2: 'Casual', 3: 'Strategic', 4: 'Master' };

const initialGameState = {
  fen: STARTING_FEN,
  turn: 'white',
  status: 'ongoing',
  winner: 'none',
  lastmove: null
};

const ColosseumPage = ({ config, onBackToMenu }) => {
  const engine = useEngine();
  
  const [gameState, setGameState] = useState(initialGameState);
  const [moveHistory, setMoveHistory] = useState([]); // Client-side history cache
  const [currentRound, setCurrentRound] = useState(0);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [initialized, setInitialized] = useState(false);
  
  const mountedRef = useRef(true);
  const initRef = useRef(false);
  const moveInProgressRef = useRef(false);
  const runningRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { 
      mountedRef.current = false;
      runningRef.current = false;
    };
  }, []);

  useEffect(() => {
    runningRef.current = running && !paused;
  }, [running, paused]);

  const getBotsForRound = (round) => {
    const swapped = round % 2 === 1;
    return {
      white: swapped ? config.blackBot : config.whiteBot,
      black: swapped ? config.whiteBot : config.blackBot
    };
  };

  const currentBots = getBotsForRound(currentRound);

  // Initialize
  useEffect(() => {
    if (!engine.connected || initRef.current) return;
    
    const init = async () => {
      initRef.current = true;
      try {
        await engine.newGame();
        const state = await engine.getGameState();
        if (state && mountedRef.current) {
          setGameState({ ...initialGameState, ...state });
          setMoveHistory([]);
          setInitialized(true);
        }
      } catch (err) {
        console.error('Init failed:', err);
        initRef.current = false;
      }
    };
    
    init();
  }, [engine.connected]);

  // Make a single move
  const makeOneMove = useCallback(async () => {
    if (!engine.connected || moveInProgressRef.current) return false;
    
    moveInProgressRef.current = true;
    
    try {
      const currentState = await engine.getGameState();
      if (!currentState || !mountedRef.current || currentState.status !== 'ongoing') {
        return false;
      }

      const currentDifficulty = currentState.turn === 'white' 
        ? currentBots.white 
        : currentBots.black;

      await engine.setPosition(currentState.fen);
      const result = await engine.go({ depth: DIFFICULTY_DEPTHS[currentDifficulty] });
      
      if (!mountedRef.current) return false;
      
      if (result?.move && result.move !== '(none)') {
        const newState = await engine.makeMove(result.move);
        if (newState && mountedRef.current) {
          setGameState(prev => ({ ...prev, ...newState }));
          setMoveHistory(prev => [...prev, result.move]);
          return newState.status === 'ongoing';
        }
      }
      
      return false;
    } catch (err) {
      console.error('Colosseum move error:', err);
      return false;
    } finally {
      moveInProgressRef.current = false;
    }
  }, [engine.connected, engine.getGameState, engine.setPosition, engine.go, engine.makeMove, currentBots]);

  // Game loop
  useEffect(() => {
    if (!initialized || !running || paused) return;
    if (gameState.status !== 'ongoing') return;
    if (moveInProgressRef.current) return;

    const doMove = async () => {
      if (!runningRef.current || !mountedRef.current) return;
      
      const canContinue = await makeOneMove();
      
      if (canContinue && runningRef.current && mountedRef.current) {
        setTimeout(doMove, 200);
      }
    };

    const timer = setTimeout(doMove, 200);
    return () => clearTimeout(timer);
  }, [initialized, running, paused, gameState.status, makeOneMove]);

  // Handle round completion
  useEffect(() => {
    if (gameState.status === 'ongoing' || !running) return;

    const result = {
      round: currentRound + 1,
      winner: gameState.winner === 'none' ? 'draw' : gameState.winner,
      moves: moveHistory.length,
      whiteBot: currentBots.white,
      blackBot: currentBots.black
    };

    setResults(prev => [...prev, result]);

    if (currentRound + 1 >= config.maxRounds) {
      setRunning(false);
      runningRef.current = false;
    } else {
      setTimeout(async () => {
        if (!mountedRef.current) return;
        
        const nextRound = currentRound + 1;
        setCurrentRound(nextRound);
        
        try {
          await engine.newGame();
          const newState = await engine.getGameState();
          if (newState && mountedRef.current) {
            setGameState({ ...initialGameState, ...newState });
            setMoveHistory([]); // Clear history for new round
          }
        } catch (err) {
          console.error('Failed to start next round:', err);
        }
      }, 2000);
    }
  }, [gameState.status, running, currentRound, config.maxRounds, currentBots, moveHistory.length, engine.newGame, engine.getGameState]);

  const handleStart = () => {
    setRunning(true);
    setPaused(false);
  };

  const handlePause = () => {
    setPaused(true);
  };

  const handleResume = () => {
    setPaused(false);
  };

  const handleStop = () => {
    setRunning(false);
    runningRef.current = false;
    engine.stop();
  };

  const handleRestart = useCallback(async () => {
    setCurrentRound(0);
    setResults([]);
    setRunning(false);
    runningRef.current = false;
    setPaused(false);
    moveInProgressRef.current = false;
    
    try {
      await engine.newGame();
      const newState = await engine.getGameState();
      if (newState && mountedRef.current) {
        setGameState({ ...initialGameState, ...newState });
        setMoveHistory([]);
      }
    } catch (err) {
      console.error('Restart failed:', err);
    }
  }, [engine.newGame, engine.getGameState]);

  const lastMove = gameState.lastmove ? (() => {
    const from = squareToIndex(gameState.lastmove.slice(0, 2));
    const to = squareToIndex(gameState.lastmove.slice(2, 4));
    if (from === -1 || to === -1) return null;
    return { from: indexToRowCol(from), to: indexToRowCol(to) };
  })() : null;

  const whiteWins = results.filter(r => r.winner === 'white').length;
  const blackWins = results.filter(r => r.winner === 'black').length;
  const draws = results.filter(r => r.winner === 'draw').length;

  if (!engine.connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900">
        <div className="text-white text-xl mb-4">Connecting to engine...</div>
        {engine.error && <div className="text-red-400 mb-4">{engine.error}</div>}
        <button onClick={engine.reconnect} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          Retry
        </button>
        <button onClick={onBackToMenu} className="mt-4 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">
          Back to Menu
        </button>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900">
        <div className="text-white text-xl">Initializing...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 relative font-sans p-4">
      <div className="absolute top-4 left-4">
        <button
          onClick={onBackToMenu}
          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm font-semibold"
        >
          ← Main Menu
        </button>
      </div>

      <div className="mb-6 text-center">
        <h1 className="text-4xl font-bold text-white mb-2">⚔️ Colosseum ⚔️</h1>
        <div className="text-gray-400">Round {currentRound + 1} / {config.maxRounds}</div>
        <div className="text-gray-500 text-sm mt-1">
          {DIFFICULTY_NAMES[currentBots.white]} (White) vs {DIFFICULTY_NAMES[currentBots.black]} (Black)
        </div>
      </div>

      <div className="flex gap-8 items-start">
        {/* Stats panel */}
        <div className="bg-gray-800 rounded-lg p-4 shadow-lg w-64">
          <h3 className="text-lg font-bold text-white mb-4 border-b border-gray-600 pb-2">Match Score</h3>
          
          <div className="grid grid-cols-3 gap-4 text-center mb-4">
            <div>
              <div className="text-2xl font-bold text-yellow-300">{whiteWins}</div>
              <div className="text-xs text-gray-400">White</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-400">{draws}</div>
              <div className="text-xs text-gray-400">Draw</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-300">{blackWins}</div>
              <div className="text-xs text-gray-400">Black</div>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Status:</span>
              <span className={`font-bold ${running && !paused ? 'text-green-400' : 'text-gray-400'}`}>
                {running ? (paused ? 'Paused' : 'Running') : 'Stopped'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Turn:</span>
              <span className="text-white">{gameState.turn}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Moves:</span>
              <span className="text-white">{moveHistory.length}</span>
            </div>
          </div>

          {results.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-600">
              <h4 className="text-sm font-bold text-gray-300 mb-2">History</h4>
              <div className="max-h-40 overflow-y-auto space-y-1 text-xs">
                {results.map((r, i) => (
                  <div key={i} className="flex justify-between text-gray-400">
                    <span>Round {r.round}</span>
                    <span className={
                      r.winner === 'white' ? 'text-yellow-300' :
                      r.winner === 'black' ? 'text-gray-300' : 'text-gray-500'
                    }>
                      {r.winner === 'draw' ? 'Draw' : `${r.winner}`} ({r.moves})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Board */}
        <div className="flex flex-col items-center">
          <ChessBoard
            fen={gameState.fen}
            selected={null}
            legalMoves={[]}
            lastMove={lastMove}
            onSquareClick={() => {}}
            flipped={currentRound % 2 === 1}
            disabled={true}
          />

          <div className="mt-6 flex gap-4">
            {!running ? (
              <button
                onClick={handleStart}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg text-lg font-semibold"
              >
                {results.length > 0 ? 'Continue' : 'Start Match'}
              </button>
            ) : paused ? (
              <button
                onClick={handleResume}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg text-lg font-semibold"
              >
                Resume
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-lg font-semibold"
              >
                Pause
              </button>
            )}

            {running && (
              <button
                onClick={handleStop}
                className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg text-lg font-semibold"
              >
                Stop
              </button>
            )}

            {!running && results.length > 0 && (
              <button
                onClick={handleRestart}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-lg font-semibold"
              >
                New Match
              </button>
            )}
          </div>
        </div>

        {/* Move history - using client cache */}
        <div className="bg-gray-800 rounded-lg p-4 shadow-lg w-64">
          <h3 className="text-lg font-bold text-white mb-4 border-b border-gray-600 pb-2">Current Game</h3>
          
          <div className="max-h-80 overflow-y-auto font-mono text-sm space-y-1">
            {moveHistory.length === 0 ? (
              <div className="text-gray-500 text-center py-4">
                {running ? 'Starting...' : 'Ready'}
              </div>
            ) : (
              (() => {
                const pairs = [];
                for (let i = 0; i < moveHistory.length; i += 2) {
                  pairs.push({
                    num: Math.floor(i / 2) + 1,
                    white: moveHistory[i],
                    black: moveHistory[i + 1]
                  });
                }
                return pairs.map((p, idx) => (
                  <div key={p.num} className={`flex py-1 px-2 rounded ${idx === pairs.length - 1 ? 'bg-gray-700' : ''}`}>
                    <span className="text-gray-500 w-8">{p.num}.</span>
                    <span className="text-white w-16">{p.white}</span>
                    <span className="text-gray-300 w-16">{p.black || ''}</span>
                  </div>
                ));
              })()
            )}
          </div>
        </div>
      </div>

      {/* Round result */}
      {gameState.status !== 'ongoing' && running && (
        <div className="mt-4 px-6 py-3 bg-gray-700 rounded-lg text-center">
          <span className="text-xl font-bold text-white">
            {gameState.winner === 'draw' || gameState.winner === 'none' ? 'Draw!' : `${gameState.winner} wins!`}
          </span>
          <span className="ml-4 text-gray-400">Next round...</span>
        </div>
      )}

      {/* Match complete */}
      {!running && results.length >= config.maxRounds && (
        <div className="mt-4 px-8 py-4 bg-purple-900 rounded-lg text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Match Complete!</h2>
          <div className="text-gray-300">
            Final: White {whiteWins} - {draws} - {blackWins} Black
          </div>
          <div className="text-lg font-bold mt-2 text-purple-300">
            {whiteWins > blackWins ? 'White Wins!' :
             blackWins > whiteWins ? 'Black Wins!' : 'Draw!'}
          </div>
        </div>
      )}
    </div>
  );
};

export default ColosseumPage;