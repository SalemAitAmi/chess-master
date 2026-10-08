/**
 * Settings editor. Displayed value = override ?? the selected profile's value
 * from the engine catalog. Save commits locally and syncs every live engine
 * (deltas only); the modal closes when all syncs succeed.
 */
import { useState, useEffect } from 'react';
import { listOptions, listProfiles, profileValues } from '../config/catalog';
import { GROUPS, uiFor, CLIENT_OPTIONS, FEN_PRESETS, STRATEGY_HELP } from '../config/ui';
import { getSettings, commitSettings, normalizeSettings, emptySettings } from '../config/settings';
const FEN_DEBOUNCE_MS = 300;
const FEN_CHIP = {
  standard: ['bg-gray-700 text-gray-300', 'standard start'], checking: ['bg-gray-700 text-gray-300', 'checking…'],
  valid: ['bg-green-900 text-green-300', 'valid'], invalid: ['bg-red-900 text-red-300', 'invalid'],
  unchecked: ['bg-yellow-900 text-yellow-300', 'not checked'],
};
const show = (v) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));
const keepSession = (ov) => Object.fromEntries(Object.entries(ov).filter(([k]) => uiFor(k).scope === 'session'));
const SettingsModal = ({ isOpen, onClose, disabled, engineReady, validateFen }) => {
  const [draft, setDraft] = useState(getSettings);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState({ engine: true, smp: true, local: true });
  const [fen, setFen] = useState({ state: 'standard', reason: null });
  const [results, setResults] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (isOpen) { setDraft(getSettings()); setResults(null); } }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);
  const startFen = (draft.client.startFen || '').trim();
  useEffect(() => {
    if (!isOpen) return undefined;
    if (startFen === '') { setFen({ state: 'standard', reason: null }); return undefined; }
    if (!validateFen) { setFen({ state: 'unchecked', reason: 'engine offline — validated at game start' }); return undefined; }
    setFen({ state: 'checking', reason: null });
    let live = true;
    const t = setTimeout(() => validateFen(startFen)
      .then(r => live && setFen(r.valid ? { state: 'valid', reason: null } : { state: 'invalid', reason: r.reason }))
      .catch(err => live && setFen({ state: 'unchecked', reason: err.message })), FEN_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [isOpen, startFen, validateFen]);
  if (!isOpen) return null;
  // ── Rows ──
  const base = engineReady ? profileValues(draft.profile) : {};
  const q = filter.trim().toLowerCase();
  const matches = (label, key) => q === '' || `${label} ${key}`.toLowerCase().includes(q);
  const rows = [];
  if (engineReady) {
    for (const o of listOptions()) {
      const ui = uiFor(o.uci);
      if (matches(ui.label, o.uci)) rows.push({ kind: 'engine', key: o.uci, o, ui });
    }
  }
  for (const c of CLIENT_OPTIONS) if (matches(c.label, c.id)) rows.push({ kind: 'client', key: c.id, o: c, ui: { ...c, group: 'local', scope: 'client' } });
  const groups = GROUPS.map(g => ({ ...g, rows: rows.filter(r => r.ui.group === g.id) })).filter(g => g.rows.length > 0);
  const valueOf = (r) => (r.kind === 'client' ? (draft.client[r.key] ?? r.o.def)
                        : (r.key in draft.overrides ? draft.overrides[r.key] : base[r.key]));
  const setValue = (r, v) => setDraft(prev => {
    if (r.kind === 'client') return { ...prev, client: { ...prev.client, [r.key]: v } };
    const overrides = { ...prev.overrides };
    if (v === base[r.key]) delete overrides[r.key]; else overrides[r.key] = v;
    return { ...prev, overrides };
  });
  const revert = (r) => setDraft(prev => { const o = { ...prev.overrides }; delete o[r.key]; return { ...prev, overrides: o }; });
  const profiles = engineReady ? listProfiles() : [{ name: draft.profile, label: draft.profile }];
  const overrideKeys = Object.keys(draft.overrides);
  // ── Actions ──
  const save = async () => {
    if (fen.state === 'invalid') { setResults([{ engine: 'start FEN', ok: false, error: fen.reason }]); return; }
    setSaving(true);
    const res = await commitSettings(draft);
    setSaving(false);
    if (res.every(r => r.ok)) { onClose(); return; }
    setResults(res);
  };
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(normalizeSettings(draft), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'chess-master-config.json'; a.click();
    URL.revokeObjectURL(url);
  };
  const importJson = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { try { setDraft(normalizeSettings(JSON.parse(String(reader.result)))); } catch (err) { console.warn('[settings] import failed:', err); } };
    reader.readAsText(file);
  };
  // ── Controls ──
  const control = (r) => {
    const v = valueOf(r);
    const type = r.o.type;
    if (type === 'check') {
      return (
        <button onClick={() => setValue(r, !v)} disabled={disabled}
          className={`px-3 py-1 rounded text-xs font-medium ${v ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'} disabled:opacity-50`}>
          {v ? 'ON' : 'OFF'}
        </button>
      );
    }
    if (type === 'combo') {
      return (
        <select value={v} onChange={e => setValue(r, e.target.value)} disabled={disabled} className="bg-gray-600 text-white rounded text-xs p-1">
          {r.o.vars.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
      );
    }
    if (type === 'fen') {
      const preset = FEN_PRESETS.find(p => p.fen === v);
      const [chip, text] = FEN_CHIP[fen.state];
      return (
        <div className="w-full space-y-2">
          <select value={preset ? preset.fen : '__custom'} disabled={disabled}
            onChange={e => { if (e.target.value !== '__custom') setValue(r, e.target.value); }}
            className="w-full bg-gray-600 text-white rounded text-xs p-1">
            {FEN_PRESETS.map(p => <option key={p.label} value={p.fen}>{p.label}</option>)}
            <option value="__custom">Custom…</option>
          </select>
          <input value={v} onChange={e => setValue(r, e.target.value)} disabled={disabled} spellCheck={false}
            placeholder="empty = standard start position" className="w-full bg-gray-700 text-white rounded p-2 text-xs font-mono" />
          <div className="flex items-center gap-2 text-xs">
            <span className={`px-2 py-0.5 rounded ${chip}`}>{text}</span>
            {fen.reason && <span className="text-gray-400 font-mono">{fen.reason}</span>}
          </div>
        </div>
      );
    }
    const step = r.ui.step ?? 1;
    const clamp = (n) => Math.max(r.o.min, Math.min(r.o.max, n));
    return (
      <div className="flex items-center gap-2">
        <input type="range" min={r.o.min} max={r.o.max} step={step} value={v} disabled={disabled}
          onChange={e => setValue(r, parseInt(e.target.value, 10))} className="w-28 accent-blue-500" />
        <input type="number" min={r.o.min} max={r.o.max} step={step} value={v} disabled={disabled}
          onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setValue(r, clamp(n)); }}
          className="w-20 bg-gray-600 text-white rounded text-xs p-1" />
        {r.ui.unit && <span className="text-gray-500 text-xs">{r.ui.unit}</span>}
      </div>
    );
  };
  const row = (r) => {
    const overridden = r.kind === 'engine' && r.key in draft.overrides;
    const meta = (
      <div className="min-w-0">
        <div className="text-gray-300 text-sm flex flex-wrap items-center gap-2">
          {r.ui.label}
          {r.ui.scope === 'session' && <span className="text-[10px] px-1 rounded bg-gray-700 text-gray-400">session</span>}
          {overridden && (
            <button onClick={() => revert(r)} disabled={disabled} className="text-amber-400 text-xs hover:text-amber-300"
              title="Revert to profile value">override ↺ <span className="text-gray-500">(profile: {show(base[r.key])})</span></button>
          )}
        </div>
        {r.kind === 'engine' && <div className="text-gray-600 text-xs font-mono">{r.key}</div>}
        {r.ui.help && <div className="text-gray-500 text-xs mt-1">{r.ui.help}</div>}
        {r.key === 'SearchStrategy' && <div className="text-gray-400 text-xs mt-1">{STRATEGY_HELP[valueOf(r)]}</div>}
      </div>
    );
    return r.o.type === 'fen'
      ? <div key={r.key} className="space-y-2">{meta}{control(r)}</div>
      : <div key={r.key} className="flex items-start justify-between gap-3">{meta}<div className="flex-shrink-0">{control(r)}</div></div>;
  };
  return (
    <div className="fixed inset-0 z-50 flex overflow-y-auto bg-black bg-opacity-60 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}
        className="m-auto flex w-[40rem] max-w-full max-h-[calc(100vh-2rem)] flex-col rounded-xl border border-gray-600 bg-gray-800 shadow-2xl animate-modal-in">
        <div className="flex-shrink-0 border-b border-gray-600 px-6 pt-5 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white"><i className="fas fa-cog mr-2" />Engine Settings</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
          </div>
          {disabled && <div className="p-2 bg-yellow-900 rounded text-yellow-200 text-sm text-center">Settings locked during active game</div>}
          {!engineReady && <div className="p-2 bg-gray-700 rounded text-gray-300 text-xs">Engine not connected — engine options appear once it is.</div>}
          <div className="flex items-center gap-2">
            <label className="text-gray-300 text-sm">Profile</label>
            <select value={draft.profile} disabled={disabled || !engineReady}
              onChange={e => { const name = e.target.value; setDraft(prev => ({ ...prev, profile: name, overrides: keepSession(prev.overrides) })); }}
              className="bg-gray-600 text-white rounded text-sm p-1">
              {profiles.map(p => <option key={p.name} value={p.name}>{p.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter options…" className="flex-1 bg-gray-700 text-white rounded p-2 text-sm" />
            <button onClick={exportJson} className="px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs">Export</button>
            <label className="px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs cursor-pointer">
              Import<input type="file" accept="application/json" onChange={importJson} className="hidden" />
            </label>
          </div>
          <div className="text-xs text-gray-400">
            {overrideKeys.length === 0 ? `Running ${draft.profile} as-is.` : `${overrideKeys.length} override(s): ${overrideKeys.join(', ')}`}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 move-history-scroll">
          {groups.map(g => (
            <div key={g.id} className="mb-3 border border-gray-700 rounded">
              <button onClick={() => setOpen(prev => ({ ...prev, [g.id]: !prev[g.id] }))}
                className="w-full flex justify-between items-center px-3 py-2 bg-gray-700 text-left">
                <span className="text-sm font-bold text-gray-200">{g.label}</span>
                <span className="text-gray-400 text-xs">{g.rows.length} · {open[g.id] || q !== '' ? '▾' : '▸'}</span>
              </button>
              {(open[g.id] || q !== '') && <div className="p-3 space-y-3">{g.rows.map(row)}</div>}
            </div>
          ))}
        </div>
        <div className="flex-shrink-0 border-t border-gray-600 px-6 py-4">
          {results && (
            <div className="mb-3 p-2 rounded bg-red-900 text-red-200 text-xs space-y-1">
              {results.map((r, i) => (
                <div key={i} className="font-mono">{r.engine}: {r.ok ? `ok (${r.changes} change(s), cfg ${r.hash ?? '-'})` : r.error}</div>
              ))}
              <div className="text-red-300">Settings are saved locally and re-sent on the next connection.</div>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setDraft(prev => ({ ...prev, overrides: keepSession(prev.overrides) }))} disabled={disabled}
              className="flex-1 py-2 rounded-lg text-sm font-semibold bg-gray-600 hover:bg-gray-500 text-white disabled:opacity-50">Reset to profile</button>
            <button onClick={() => setDraft(emptySettings())} disabled={disabled}
              className="flex-1 py-2 rounded-lg text-sm font-semibold bg-gray-600 hover:bg-gray-500 text-white disabled:opacity-50">Reset all</button>
            <button onClick={save} disabled={disabled || saving}
              className="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
              {saving ? 'Applying…' : 'Save & apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
export default SettingsModal;