/**
 * Session loading UI: a drop zone with two pickers. Rendered inline on the
 * empty Sandbox page, and inside the "Load New Session" dialog once a session
 * is open (the Session panel itself no longer loads anything).
 *
 * Accepts a whole session folder (directory picker or folder drop), loose
 * NDJSON / replay JSON files, or client-saved `*.match.json` human games.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../../components/Modal';
import Icon from '../../components/Icon';
import { filesFromDataTransfer } from '../ndjson';

/** A <label> styled as a pill; the hidden file input does the picking. */
const PickerButton = ({ icon, primary = false, inputRef = null, accept, onChange, children }) => (
  <label className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-colors
    ${primary ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}>
    <Icon name={icon} size={14} />
    {children}
    <input ref={inputRef} type="file" multiple accept={accept} className="hidden" onChange={onChange} />
  </label>
);

export const SessionLoader = ({ onLoad, loading, error }) => {
  // ── State ──
  const [dragging, setDragging] = useState(false);

  // ── Refs ──
  const dirInputRef = useRef(null);

  // ── Effects ──
  // `webkitdirectory` is not a prop React passes through, so it is set on the node.
  useEffect(() => {
    const el = dirInputRef.current;
    if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); }
  }, []);

  // ── Callbacks ──
  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragging(false);
    onLoad(await filesFromDataTransfer(e.dataTransfer));
  }, [onLoad]);

  /** Copy the files out first: clearing the input (so the same folder can be re-picked) empties its FileList. */
  const onPick = useCallback((e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    onLoad(files);
  }, [onLoad]);

  // ── Render ──
  return (
    <div>
      {/* Drop zone */}
      <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors
          ${dragging ? 'border-blue-400 bg-blue-500/10' : 'border-gray-600 bg-gray-900/40'}`}>
        <Icon name="upload" size={28} className="mx-auto text-gray-400" />
        <div className="mt-2 text-sm text-gray-300">
          Drop <span className="font-mono">engine/logs/&lt;session&gt;</span> here
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <PickerButton icon="folder" primary inputRef={dirInputRef} onChange={onPick}>
            {loading ? 'Loading…' : 'Open session folder'}
          </PickerButton>
          <PickerButton icon="file" accept=".ndjson,.json" onChange={onPick}>Pick files</PickerButton>
        </div>
        <div className="mt-2 text-[11px] text-gray-500">
          Session folders, replay exports, or saved <span className="font-mono">*.match.json</span> games
        </div>
      </div>

      {/* Load error */}
      {error && <div className="mt-2 text-xs text-red-300 font-mono break-words">{error}</div>}
    </div>
  );
};

/** "Load New Session" dialog — opened from the header chip. */
export const LoadSessionModal = ({ open, onClose, onLoad, loading, error }) => (
  <Modal open={open} onClose={onClose} title="Load New Session" icon="fa-folder-open" width="w-[30rem]">
    <SessionLoader onLoad={onLoad} loading={loading} error={error} />
    <p className="mt-3 text-[11px] text-gray-500">The current session stays open until the new one loads successfully.</p>
  </Modal>
);

export default SessionLoader;