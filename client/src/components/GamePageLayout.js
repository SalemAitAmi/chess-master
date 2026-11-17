/**
 * Shared page shell for every game mode, plus the shared page header.
 *
 *   HEADER   nav + page actions (left) · title/subtitle (center) · settings gutter (right)
 *   MAIN     LEFT panels · BOARD + control bar · RIGHT panels
 *   FOOTER   mode-specific summary (match complete, …)
 *   OVERLAYS promotion / game-over modals (absolute, centred on the page)
 *
 * SIZING POLICY — minimise dead space.
 *   The page is exactly one viewport tall. The board column's flex BASIS is
 *   "viewport height minus vertical chrome": in the side-by-side layout (xl)
 *   that is its width, in the stacked layout its height. Either way it is
 *   the size at which the board becomes height-limited, so the column is
 *   never wider than the board it holds. Side columns grow between min and
 *   max widths into what is left; panels scroll inside their column, the
 *   page never scrolls at xl. Status text shares the control bar under the
 *   board instead of reserving its own row.
 *
 * EngineGate is the failure-path front door: connecting → error →
 * initializing → children. Every state has an escape (Retry / Back to Menu).
 */
import { Button } from './primitives';
import Icon from './Icon';

export const PAGE_BG = 'bg-gradient-to-br from-gray-800 to-gray-900 font-sans';

/** Board column. Basis ≈ 100vh − (header ≈5rem + control bar ≈3.25rem + gaps). */
const BOARD_COLUMN = 'flex flex-col items-center gap-3 min-w-0 shrink-0 basis-[calc(100vh_-_9.5rem)] xl:shrink xl:min-h-0';

/** Side columns: full width when stacked; flexible between bounds at xl, scrolling internally. */
const SIDE_COLUMN = 'w-full shrink-0 xl:w-auto xl:flex-1 xl:min-w-[16rem] xl:max-w-[28rem] xl:min-h-0 ' +
                    'xl:overflow-y-auto flex flex-col gap-3 move-history-scroll';

// ═══════════════════════════════════════════════════════════════════════════
// Header
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Three-column grid so the title is centred on the PAGE regardless of how
 * many actions sit on the left. The right column stays empty: App renders
 * the settings button fixed at top-right.
 */
export const PageHeader = ({ title, subtitle = null, onBackToMenu, actions = null }) => (
  <header className="flex-none grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-4 px-4 pt-3 pb-2">
    {/* Left: navigation + page actions */}
    <div className="flex flex-wrap items-center gap-2 min-w-0">
      <Button tone="neutral" onClick={onBackToMenu} className="inline-flex items-center gap-2">
        <Icon name="arrow-left" size={15} /> Main Menu
      </Button>
      {actions}
    </div>

    {/* Center: title */}
    <div className="text-center min-w-0">
      <h1 className="text-2xl md:text-3xl font-bold text-white leading-tight truncate">{title}</h1>
      {subtitle && <div className="text-gray-400 text-sm mt-0.5 truncate" title={subtitle}>{subtitle}</div>}
    </div>

    {/* Right: reserved for App's fixed settings button */}
    <div aria-hidden="true" />
  </header>
);

// ═══════════════════════════════════════════════════════════════════════════
// Gate
// ═══════════════════════════════════════════════════════════════════════════

const GateScreen = ({ children, actions }) => (
  <div className={`${PAGE_BG} min-h-screen flex flex-col items-center justify-center gap-4 p-4 text-center`}>
    {children}
    <div className="flex flex-wrap justify-center gap-3">{actions}</div>
  </div>
);

export const EngineGate = ({ engine, session, onBackToMenu, children }) => {
  const back = <Button tone="neutral" onClick={onBackToMenu}>Back to Menu</Button>;

  if (!engine.connected) {
    return (
      <GateScreen actions={<><Button tone="primary" onClick={engine.reconnect}>Retry</Button>{back}</>}>
        <div className="text-white text-xl">Connecting to engine...</div>
        {engine.error && <div className="text-red-400 max-w-md">{engine.error}</div>}
      </GateScreen>
    );
  }
  if (session.sessionError !== null) {
    return (
      <GateScreen actions={<>
        <Button tone="primary" onClick={session.retryInit}>Retry</Button>
        <Button tone="caution" onClick={engine.reconnect}>Reconnect Engine</Button>
        {back}
      </>}>
        <div className="text-red-300 text-xl">Failed to start game</div>
        <div className="text-red-400 max-w-md font-mono text-sm">{session.sessionError}</div>
      </GateScreen>
    );
  }
  if (!session.initialized) {
    return (
      <GateScreen actions={back}>
        <div className="text-white text-xl animate-pulse">Initializing game...</div>
      </GateScreen>
    );
  }
  return children;
};

// ═══════════════════════════════════════════════════════════════════════════
// Shared controls
// ═══════════════════════════════════════════════════════════════════════════

/** Undo + Surrender, shared by the human-player pages. */
export const PlayerControls = ({ canUndo, onUndo, onSurrender, surrenderDisabled = false }) => (
  <>
    <Button size="lg" tone="primary" disabled={!canUndo} onClick={onUndo}>↶ Undo</Button>
    <Button size="lg" tone="danger" disabled={surrenderDisabled} onClick={onSurrender}>⚑ Surrender</Button>
  </>
);

// ═══════════════════════════════════════════════════════════════════════════
// Layout
// ═══════════════════════════════════════════════════════════════════════════

const GamePageLayout = ({
  title, subtitle, onBackToMenu,
  headerActions = null,
  banner = null,
  leftPanels = null,
  board = null,
  controls = null,
  rightPanels = null,
  footer = null,
  overlays = null,
}) => (
  <div className={`${PAGE_BG} relative h-screen flex flex-col overflow-hidden`}>
    {/* ── HEADER ── */}
    <PageHeader title={title} subtitle={subtitle} onBackToMenu={onBackToMenu} actions={headerActions} />

    {/* ── MAIN ── */}
    <main className="flex-1 min-h-0 flex flex-col xl:flex-row xl:justify-center gap-4 px-4 pb-4 overflow-y-auto xl:overflow-hidden move-history-scroll">
      {/* LEFT: game info, captures, mode-specific panels */}
      <aside className={`${SIDE_COLUMN} order-2 xl:order-1`}>{leftPanels}</aside>

      {/* CENTER: board slot (definite size; the board fills it) + control bar */}
      <section className={`${BOARD_COLUMN} order-1 xl:order-2`}>
        <div className="flex w-full flex-1 min-h-0">{board}</div>
        {/* Always rendered (min height) so status changes never resize the board */}
        <div className="flex-none w-full flex flex-wrap items-center justify-center gap-3 min-h-[3.25rem]">
          {controls}
          {banner}
        </div>
      </section>

      {/* RIGHT: move history (fills the column) */}
      <aside className={`${SIDE_COLUMN} order-3`}>{rightPanels}</aside>
    </main>

    {/* ── FOOTER ── */}
    {footer && <footer className="flex-none px-4 pb-4 flex justify-center">{footer}</footer>}

    {/* ── OVERLAYS ── */}
    {overlays}
  </div>
);

export default GamePageLayout;