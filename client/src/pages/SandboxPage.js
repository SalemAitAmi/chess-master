/**
 * Sandbox — replay a logged session as a debugger.
 *
 *   Game level      ◀ ▶ step through decisions; the timeline is the source view
 *   Decision level  ⤵ into a turn: Result → Root policy → d=N … d=1 → Setup
 *   Trace level     ⤵ into a frame: the sampled records of its seq window
 *
 * The board is the navigation surface: click a piece of the side to move to
 * see its candidates as destination dots; click a dot to open that move.
 * Lenses re-encode the same candidates (score / effort / ordering / one
 * heuristic) without changing what is selected.
 *
 * No engine connection is used: everything comes from the loaded records, and
 * positions along a line are rendered (not validated) from the logged FEN.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ChessBoard from '../components/ChessBoard';
import { loadSessionFiles } from '../sandbox/ndjson';
import { buildSession } from '../sandbox/model';
import { initialNav, navReduce } from '../sandbox/nav';
import { deriveView } from '../sandbox/view';
import { rcToSquare } from '../sandbox/fenUtils';
import { lastMoveToCoords } from '../utils/chessUtils';
import { reportFailure } from '../utils/failure';
import SessionPanel from '../sandbox/components/SessionPanel';
import DebuggerControls from '../sandbox/components/DebuggerControls';
import FrameList from '../sandbox/components/FrameList';
import TurnSummary from '../sandbox/components/TurnSummary';
import PieceView from '../sandbox/components/PieceView';
import MoveView from '../sandbox/components/MoveView';
import LinePanel from '../sandbox/components/LinePanel';
import SearchProfile from '../sandbox/components/SearchProfile';
import Timeline from '../sandbox/components/Timeline';

const PAGE_BG = 'min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 font-sans';
const KEYS = { ArrowRight: 'step-over', ArrowLeft: 'step-back', ArrowDown: 'step-into', ArrowUp: 'step-out', Home: 'first', End: 'last' };

const SandboxPage = ({ onBackToMenu }) => {
  const [session, setSession] = useState(null);
  const sessionRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [nav, setNav] = useState(initialNav);
  const dispatch = useCallback((a) => setNav(prev => navReduce(prev, a, sessionRef.current)), []);

  const load = useCallback(async (files) => {
    if (!files || files.length === 0) return;
    setLoading(true); setError(null);
    try {
      const raw = await loadSessionFiles(files);
      const model = buildSession(raw);
      sessionRef.current = model;
      setSession(model);
      setNav(initialNav());
    } catch (err) {
      reportFailure('SandboxPage.load', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const view = useMemo(() => (session ? deriveView(session, nav) : null), [session, nav]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (!sessionRef.current) return;
      const a = KEYS[e.key];
      if (a) { e.preventDefault(); dispatch({ type: a }); return; }
      if (e.key === 'Escape') dispatch({ type: 'clear-selection' });
      else if (e.key === 'a') dispatch({ type: 'toggle-after' });
      else if (e.key === 'f') dispatch({ type: 'toggle-flip' });
      else if (e.key === ']') dispatch({ type: 'pv-step', dir: 1 });
      else if (e.key === '[') dispatch({ type: 'pv-step', dir: -1 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  const onSquareClick = useCallback((row, col) => {
    if (!view || !view.turn) return;
    const sq = rcToSquare(row, col);
    const cands = view.turn.candidates;
    if (nav.selected) {
      const hit = cands.find(c => c.from === nav.selected && c.to === sq);
      if (hit) { dispatch({ type: 'pick-move', alg: hit.alg }); return; }
    }
    if (cands.some(c => c.from === sq)) { dispatch({ type: 'select-square', square: sq }); return; }
    const dot = nav.lens !== 'result' ? cands.find(c => c.to === sq) : null;
    if (dot) { dispatch({ type: 'pick-move', alg: dot.alg }); return; }
    dispatch({ type: 'clear-selection' });
  }, [view, nav.selected, nav.lens, dispatch]);

  const header = (
    <header className="flex items-center justify-between px-4 pt-4 pb-2 gap-4">
      <div className="w-32 flex-shrink-0">
        <button onClick={onBackToMenu}
          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all duration-200 shadow-md text-sm font-semibold">
          ← Main Menu
        </button>
      </div>
      <div className="text-center flex-1 min-w-0">
        <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight truncate">🧪 Sandbox</h1>
        <div className="text-gray-400 text-sm mt-1 truncate">
          {session ? `${session.name} · ${session.games.length} game(s) · ${session.turnCount} decisions` : 'replay debugger — load a log session'}
        </div>
      </div>
      <div className="w-32 flex-shrink-0" aria-hidden="true" />
    </header>
  );

  if (!session || !view) {
    return (
      <div className={`${PAGE_BG} flex flex-col`}>
        {header}
        <main className="flex-1 flex items-start justify-center px-4 pb-4">
          <div className="w-full max-w-2xl space-y-4">
            <SessionPanel session={null} nav={nav} dispatch={dispatch} onLoad={load} loading={loading} error={error} />
            <div className="bg-gray-800 rounded-lg p-4 shadow-lg text-sm text-gray-300 space-y-2">
              <p>Open <span className="font-mono">engine/logs/&lt;session&gt;</span> (the folder with <span className="font-mono">game-N/</span> directories), or a <span className="font-mono">analysis/replay</span> export from <span className="font-mono">analyze_logs.py --export-replay</span> (lighter: no sampled traces).</p>
              <p className="text-gray-400">Keys: ← → step · ↓ step into · ↑ step out · Home/End · a after · f flip · [ ] walk the line · Esc clear.</p>
              <p className="text-gray-500 text-xs">The engine is not contacted. Sampled traces are reconciled with the session's sample rate (from <span className="font-mono">session.json</span>, or inferred from <span className="font-mono">ti</span> fields).</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const { turn } = view;
  return (
    <div className={`${PAGE_BG} relative flex flex-col`}>
      {header}
      <div className="px-4 pb-2">
        <DebuggerControls session={session} nav={nav} dispatch={dispatch} view={view} />
      </div>
      <main className="flex-1 min-h-0 px-4 pb-2 flex justify-center">
        <div className="w-full max-w-[1600px] flex flex-wrap xl:flex-nowrap gap-4 items-start justify-center">
          <aside className="w-80 flex flex-col gap-4 order-2 xl:order-1">
            <SessionPanel session={session} nav={nav} dispatch={dispatch} onLoad={load} loading={loading} error={error} />
            <FrameList view={view} nav={nav} dispatch={dispatch} session={session} />
          </aside>
          <section className="flex flex-col items-center gap-3 order-1 xl:order-2 flex-shrink-0">
            {turn ? (
              <>
                <div className="text-xs text-gray-400 font-mono">
                  {view.afterApplied ? `after ${view.lastMove}` : nav.pvPly > 0 ? `line ply ${nav.pvPly}: ${view.lastMove}` : `root position · ${view.sideToMove} to move`}
                  {nav.selected && ` · ${nav.selected} selected`}
                  {nav.pick && ` · ${nav.pick}`}
                </div>
                <ChessBoard fen={view.fen} selected={null} legalMoves={[]} lastMove={lastMoveToCoords(view.lastMove)}
                  onSquareClick={onSquareClick} flipped={nav.flip} disabled={false} marks={view.marks} arrows={view.arrows} />
                <div className="w-full max-w-[40rem] space-y-3">
                  <LinePanel view={view} nav={nav} dispatch={dispatch} />
                  <SearchProfile turn={turn} nav={nav} view={view} dispatch={dispatch} />
                </div>
              </>
            ) : (
              <div className="text-gray-400 p-8">This game has no <span className="font-mono">turn</span> records (SEARCH logging was off).</div>
            )}
          </section>
          <aside className="w-96 flex flex-col gap-4 order-3">
            <TurnSummary view={view} session={session} />
            <PieceView view={view} nav={nav} dispatch={dispatch} />
            <MoveView view={view} nav={nav} dispatch={dispatch} />
          </aside>
        </div>
      </main>
      <footer className="px-4 pb-4">
        <Timeline game={view.game} nav={nav} dispatch={dispatch} accents={session.accents} />
      </footer>
    </div>
  );
};

export default SandboxPage;