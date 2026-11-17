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
 *
 * LAYOUT (xl): one viewport tall, nothing scrolls the page.
 *   header (Main Menu · Load New Session chip) → debugger bar →
 *   [session / search profile / trace] [board + line] [turn / piece / move] →
 *   timeline.
 * The board column's basis is the height left after the chrome (≈25rem), so
 * the board is as large as the height allows and side columns take the rest.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ChessBoard from '../components/ChessBoard';
import Icon from '../components/Icon';
import { PAGE_BG, PageHeader } from '../components/GamePageLayout';
import { Chip, Panel } from '../components/primitives';
import { loadSessionFiles } from '../sandbox/ndjson';
import { preprocessMatchRecords } from '../sandbox/humanGames';
import { buildSession } from '../sandbox/model';
import { initialNav, navReduce } from '../sandbox/nav';
import { deriveView } from '../sandbox/view';
import { lastMoveToCoords, squareFromRowCol } from '../utils/chessUtils';
import { reportFailure } from '../utils/failure';
import SessionPanel from '../sandbox/components/SessionPanel';
import SessionLoader, { LoadSessionModal } from '../sandbox/components/SessionLoader';
import DebuggerControls from '../sandbox/components/DebuggerControls';
import FrameList from '../sandbox/components/FrameList';
import TurnSummary from '../sandbox/components/TurnSummary';
import PieceView from '../sandbox/components/PieceView';
import MoveView from '../sandbox/components/MoveView';
import LinePanel from '../sandbox/components/LinePanel';
import SearchProfile from '../sandbox/components/SearchProfile';
import Timeline from '../sandbox/components/Timeline';

// ── Keyboard ──
/** Navigation keys (default browser action suppressed: they would scroll). */
const NAV_KEYS = {
  ArrowRight: { type: 'step-over' }, ArrowLeft: { type: 'step-back' },
  ArrowDown: { type: 'step-into' }, ArrowUp: { type: 'step-out' },
  Home: { type: 'first' }, End: { type: 'last' },
};
/** View toggles. */
const TOGGLE_KEYS = {
  Escape: { type: 'clear-selection' },
  a: { type: 'toggle-after' },
  f: { type: 'toggle-flip' },
  ']': { type: 'pv-step', dir: 1 },
  '[': { type: 'pv-step', dir: -1 },
};
const TYPING_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

// ── Layout ──
const SIDE = 'w-full shrink-0 xl:w-auto xl:flex-1 xl:min-h-0 xl:overflow-y-auto flex flex-col gap-3 move-history-scroll';
const LEFT_COLUMN = `${SIDE} order-2 xl:order-1 xl:min-w-[18rem] xl:max-w-[28rem]`;
const RIGHT_COLUMN = `${SIDE} order-3 xl:min-w-[20rem] xl:max-w-[34rem]`;
/** Basis = board size: height when stacked, width at xl (see header). */
const BOARD_COLUMN = 'order-1 xl:order-2 flex flex-col gap-2 min-w-0 shrink-0 ' +
                     'basis-[calc(100vh_-_12rem)] xl:basis-[calc(100vh_-_25rem)] xl:shrink xl:min-h-0';

// ═══════════════════════════════════════════════════════════════════════════
// Empty state
// ═══════════════════════════════════════════════════════════════════════════

const EmptyState = ({ onLoad, loading, error }) => (
  <main className="flex-1 min-h-0 overflow-y-auto flex items-start justify-center px-4 pb-4 move-history-scroll">
    <div className="w-full max-w-2xl space-y-4 pt-4">
      {/* Loader */}
      <Panel size="md" title="Open a log session">
        <SessionLoader onLoad={onLoad} loading={loading} error={error} />
      </Panel>

      {/* Help */}
      <Panel size="md" title="How it works">
        <div className="text-sm text-gray-300 space-y-2">
          <p>
            Open <span className="font-mono">engine/logs/&lt;session&gt;</span> (the folder with <span className="font-mono">game-N/</span> directories),
            or an <span className="font-mono">analysis/replay</span> export from <span className="font-mono">analyze_logs.py --export-replay</span> (lighter: no sampled traces).
          </p>
          <p className="text-gray-400">Keys: ← → step · ↓ step into · ↑ step out · Home/End · a after · f flip · [ ] walk the line · Esc clear.</p>
          <p className="text-gray-500 text-xs">
            The engine is not contacted. Sampled traces are reconciled with the session's sample rate
            (from <span className="font-mono">session.json</span>, or inferred from <span className="font-mono">ti</span> fields).
          </p>
        </div>
      </Panel>
    </div>
  </main>
);

// ═══════════════════════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════════════════════

const SandboxPage = ({ onBackToMenu }) => {
  // ── State ──
  const [session, setSession] = useState(null);
  const [nav, setNav] = useState(initialNav);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaderOpen, setLoaderOpen] = useState(false);

  // ── Refs ──
  // navReduce needs the session, but dispatch must keep a stable identity
  // (it is bound to the keyboard handler and passed to every panel), so the
  // reducer reads the session through a ref instead of closing over it.
  const sessionRef = useRef(null);

  // ── Derived ──
  const view = useMemo(() => (session ? deriveView(session, nav) : null), [session, nav]);
  const turn = view ? view.turn : null;
  const subtitle = session
    ? `${session.name} · ${session.games.length} game(s) · ${session.turnCount} decisions`
    : 'replay debugger — load a log session';

  // ── Callbacks ──

  const dispatch = useCallback((action) => setNav(prev => navReduce(prev, action, sessionRef.current)), []);

  /** @returns {Promise<boolean>} true when a new session replaced the old one */
  const load = useCallback(async (files) => {
    if (!files || files.length === 0) return false;
    setLoading(true);
    setError(null);
    try {
      const raw = await loadSessionFiles(files);
      // Human games arrive as bare move lists; bring them to the same raw shape.
      // TODO(human-analysis): pass an engine-backed analyzer once the engine
      // can return full root rankings (see sandbox/humanGames.js).
      if (raw.matchRecords.length > 0) await preprocessMatchRecords(raw);
      const model = buildSession(raw);
      sessionRef.current = model;
      setSession(model);
      setNav(initialNav());
      return true;
    } catch (err) {
      reportFailure('SandboxPage.load', err);
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const openLoader = useCallback(() => { setError(null); setLoaderOpen(true); }, []);
  const closeLoader = useCallback(() => setLoaderOpen(false), []);
  const loadFromModal = useCallback(async (files) => { if (await load(files)) setLoaderOpen(false); }, [load]);

  /**
   * Board clicks, in priority order: a destination of the selected piece
   * opens that move; a square with candidates selects it; outside the Result
   * lens any destination dot opens its move; anything else clears.
   */
  const onSquareClick = useCallback((row, col) => {
    if (!view || !view.turn) return;
    const sq = squareFromRowCol(row, col);
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

  // ── Effects ──

  // Debugger keys. Quiet while typing and while ANY dialog (Settings, Load)
  // is open, so Escape closes the dialog instead of clearing the selection.
  useEffect(() => {
    const onKey = (e) => {
      if (!sessionRef.current) return;
      if (e.target && TYPING_TAGS.has(e.target.tagName)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const navAction = NAV_KEYS[e.key];
      if (navAction) { e.preventDefault(); dispatch(navAction); return; }
      const toggle = TOGGLE_KEYS[e.key];
      if (toggle) dispatch(toggle);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  // ── Render ──
  const boardCaption = turn && [
    view.afterApplied ? `after ${view.lastMove}`
      : nav.pvPly > 0 ? `line ply ${nav.pvPly}: ${view.lastMove}`
      : `root position · ${view.sideToMove} to move`,
    nav.selected && `${nav.selected} selected`,
    nav.pick,
  ].filter(Boolean).join(' · ');

  return (
    <div className={`${PAGE_BG} relative h-screen flex flex-col overflow-hidden`}>
      {/* ── HEADER: navigation · Load New Session chip · title ── */}
      <PageHeader title="🧪 Sandbox" subtitle={subtitle} onBackToMenu={onBackToMenu}
        actions={session && (
          <Chip icon={<Icon name="folder" size={14} />} onClick={openLoader} title="Replace the loaded session">
            Load New Session
          </Chip>
        )} />

      {!session ? (
        <EmptyState onLoad={load} loading={loading} error={error} />
      ) : (
        <>
          {/* ── DEBUGGER CONTROLS ── */}
          <div className="flex-none px-4 pb-2">
            <DebuggerControls nav={nav} dispatch={dispatch} view={view} />
          </div>

          {/* ── MAIN ── */}
          <main className="flex-1 min-h-0 px-4 pb-2 flex flex-col xl:flex-row xl:justify-center gap-3 overflow-y-auto xl:overflow-hidden move-history-scroll">
            {/* LEFT: what was loaded, how the search evolved, the decision trace */}
            <aside className={LEFT_COLUMN}>
              <SessionPanel session={session} nav={nav} dispatch={dispatch} />
              {turn && <SearchProfile turn={turn} nav={nav} view={view} dispatch={dispatch} />}
              <FrameList view={view} nav={nav} dispatch={dispatch} session={session} />
            </aside>

            {/* CENTER: board (fills) + the line it is showing */}
            <section className={BOARD_COLUMN}>
              {turn ? (
                <>
                  <div className="flex-none text-xs text-gray-400 font-mono text-center truncate">{boardCaption}</div>
                  <div className="flex w-full flex-1 min-h-0">
                    <ChessBoard fen={view.fen} lastMove={lastMoveToCoords(view.lastMove)} onSquareClick={onSquareClick}
                      flipped={nav.flip} marks={view.marks} arrows={view.arrows} />
                  </div>
                  <LinePanel view={view} nav={nav} dispatch={dispatch} />
                </>
              ) : (
                <div className="text-gray-400 p-8 text-center">
                  This game has no <span className="font-mono">turn</span> records (SEARCH logging was off).
                </div>
              )}
            </section>

            {/* RIGHT: the focused decision, piece and move */}
            <aside className={RIGHT_COLUMN}>
              <TurnSummary view={view} session={session} />
              <PieceView view={view} nav={nav} dispatch={dispatch} />
              <MoveView view={view} dispatch={dispatch} />
            </aside>
          </main>

          {/* ── TIMELINE ── */}
          <footer className="flex-none px-4 pb-3">
            <Timeline game={view.game} nav={nav} dispatch={dispatch} accents={session.accents} />
          </footer>
        </>
      )}

      {/* ── OVERLAYS ── */}
      <LoadSessionModal open={loaderOpen} onClose={closeLoader} onLoad={loadFromModal} loading={loading} error={error} />
    </div>
  );
};

export default SandboxPage;