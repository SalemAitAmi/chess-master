/**
 * Shared page shell for every game mode. All three pages render the same
 * annotated sections in the same order and with identical styling:
 *
 *   HEADER   nav (left) · title/subtitle (center) · settings gutter (right)
 *   BANNER   transient status (thinking, errors, round result)
 *   MAIN     LEFT panels (info, captures, mode-specific) · BOARD + controls · RIGHT (history)
 *   FOOTER   mode-specific summary (match complete, etc.)
 *   OVERLAYS promotion / game-over modals (absolute, centred on the page)
 *
 * Viewport policy: the page is a column that fills the viewport; MAIN is the
 * only growing region and never scrolls the page — panels scroll internally.
 * At ≥1280px the three columns sit side by side; below that the board comes
 * first and the panels wrap under it.
 *
 * EngineGate is the failure-path front door: connecting → error → initializing
 * → children. Every state has an escape (Retry / Back to Menu) so the page
 * can never sit on a spinner with nothing to click.
 */
import React from 'react';

const PAGE_BG = 'min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 font-sans';
const PANEL_WIDTH = 'w-64';

// ═══════════════════════════════════════════════════════════════════════════
// Gate
// ═══════════════════════════════════════════════════════════════════════════
export const EngineGate = ({ engine, session, onBackToMenu, children }) => {
  if (!engine.connected) {
    return (
      <div className={`${PAGE_BG} flex flex-col items-center justify-center`}>
        <div className="text-white text-xl mb-4">Connecting to engine...</div>
        {engine.error && <div className="text-red-400 mb-4 max-w-md text-center">{engine.error}</div>}
        <div className="flex gap-3">
          <button onClick={engine.reconnect}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Retry</button>
          <button onClick={onBackToMenu}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">Back to Menu</button>
        </div>
      </div>
    );
  }

  if (session.sessionError !== null) {
    return (
      <div className={`${PAGE_BG} flex flex-col items-center justify-center`}>
        <div className="text-red-300 text-xl mb-2">Failed to start game</div>
        <div className="text-red-400 mb-6 max-w-md text-center font-mono text-sm">{session.sessionError}</div>
        <div className="flex gap-3">
          <button onClick={session.retryInit}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Retry</button>
          <button onClick={engine.reconnect}
            className="px-4 py-2 bg-yellow-700 text-white rounded hover:bg-yellow-600">Reconnect Engine</button>
          <button onClick={onBackToMenu}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">Back to Menu</button>
        </div>
      </div>
    );
  }

  if (!session.initialized) {
    return (
      <div className={`${PAGE_BG} flex flex-col items-center justify-center`}>
        <div className="text-white text-xl mb-4 animate-pulse">Initializing game...</div>
        <button onClick={onBackToMenu}
          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">Back to Menu</button>
      </div>
    );
  }

  return children;
};

// ═══════════════════════════════════════════════════════════════════════════
// Layout
// ═══════════════════════════════════════════════════════════════════════════
const GamePageLayout = ({
  title, subtitle, onBackToMenu,
  banner = null,
  leftPanels = null,
  board = null,
  controls = null,
  rightPanels = null,
  footer = null,
  overlays = null,
}) => {
  return (
    <div className={`${PAGE_BG} relative flex flex-col`}>
      {/* ── HEADER ── */}
      <header className="flex items-center justify-between px-4 pt-4 pb-2 gap-4">
        <div className="w-32 flex-shrink-0">
          <button
            onClick={onBackToMenu}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700
              transition-all duration-200 shadow-md text-sm font-semibold"
          >
            ← Main Menu
          </button>
        </div>
        <div className="text-center flex-1 min-w-0">
          <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight truncate">{title}</h1>
          {subtitle && <div className="text-gray-400 text-sm mt-1 truncate">{subtitle}</div>}
        </div>
        {/* Gutter reserved for App's fixed settings button (top-4 right-4). */}
        <div className="w-32 flex-shrink-0" aria-hidden="true" />
      </header>

      {/* ── BANNER ── */}
      <div className="px-4 min-h-[3rem] flex items-center justify-center">
        {banner}
      </div>

      {/* ── MAIN ── */}
      <main className="flex-1 min-h-0 px-4 pb-4 flex items-start justify-center">
        <div className="w-full max-w-[1400px] flex flex-wrap xl:flex-nowrap gap-4 items-start justify-center">
          {/* LEFT: game info, captures, mode-specific panels */}
          <aside className={`${PANEL_WIDTH} flex flex-col gap-4 order-2 xl:order-1`}>
            {leftPanels}
          </aside>

          {/* CENTER: board + controls */}
          <section className="flex flex-col items-center order-1 xl:order-2 flex-shrink-0">
            {board}
            {controls && <div className="mt-4 flex flex-wrap gap-3 justify-center">{controls}</div>}
          </section>

          {/* RIGHT: move history */}
          <aside className={`${PANEL_WIDTH} flex flex-col gap-4 order-3`}>
            {rightPanels}
          </aside>
        </div>
      </main>

      {/* ── FOOTER ── */}
      {footer && <footer className="px-4 pb-4 flex justify-center">{footer}</footer>}

      {/* ── OVERLAYS ── */}
      {overlays}
    </div>
  );
};

export default GamePageLayout;