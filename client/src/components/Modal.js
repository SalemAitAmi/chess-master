/**
 * Dialog shell shared by every modal that lives in normal document flow
 * (Settings, Load Session). GameOver/Promotion are page-anchored overlays and
 * intentionally do not use this.
 *
 *   ┌ header: icon + title + ×,  then `headerExtra` (sticky) ┐
 *   │ body: children — the only scrolling region            │
 *   └ footer (optional, sticky)                             ┘
 *
 * Backdrop closes on MOUSEDOWN, not click, so a text selection or slider drag
 * that ends outside the dialog does not close it. Escape closes while open.
 * `role="dialog"` is also what page-level keyboard handlers look for to stay
 * quiet while a dialog is up.
 */
import { useEffect } from 'react';

const Modal = ({ open, onClose, title, icon = null, width = 'w-[28rem]', headerExtra = null, footer = null, children }) => {
  // ── Effects ──
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // ── Render ──
  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex overflow-y-auto bg-black bg-opacity-60 p-4" onMouseDown={onClose}>
      {/* Dialog */}
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => e.stopPropagation()}
        className={`m-auto flex ${width} max-w-full max-h-[calc(100vh-2rem)] flex-col rounded-xl border border-gray-600 bg-gray-800 shadow-2xl animate-modal-in`}>
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-600 px-6 pt-5 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">{icon && <i className={`fas ${icon} mr-2`} />}{title}</h2>
            <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
          </div>
          {headerExtra}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 move-history-scroll">{children}</div>

        {/* Footer */}
        {footer && <div className="flex-shrink-0 border-t border-gray-600 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
};

export default Modal;