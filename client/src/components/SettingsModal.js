/**
 * Settings editor. Displayed value = override ?? the selected profile's value
 * from the engine catalog. Save commits locally and syncs every live engine
 * (deltas only); the modal closes when all syncs succeed.
 */
import { useState, useEffect } from 'react';
import Modal from './Modal';
import { Button } from './primitives';
import { listOptions, listProfiles, profileValues } from '../config/catalog';
import { GROUPS, uiFor, CLIENT_OPTIONS, FEN_PRESETS, STRATEGY_HELP } from '../config/ui';
import { getSettings, commitSettings, normalizeSettings, emptySettings } from '../config/settings';
import { downloadJson } from '../utils/download';

const FEN_DEBOUNCE_MS = 300;
const FEN_STANDARD = { state: 'standard', reason: null };
const FEN_CHIP = {
  standard: ['bg-gray-700 text-gray-300', 'standard start'],
  checking: ['bg-gray-700 text-gray-300', 'checking…'],
  valid: ['bg-green-900 text-green-300', 'valid'],
  invalid: ['bg-red-900 text-red-300', 'invalid'],
  unchecked: ['bg-yellow-900 text-yellow-300', 'not checked'],
};
const DEFAULT_EXPANDED = { engine: true, smp: true, local: true };

const show = (v) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));

/** Session-scope overrides survive a profile change; profile-scope ones do not. */
const keepSession = (ov) => Object.fromEntries(Object.entries(ov).filter(([k]) => uiFor(k).scope === 'session'));

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Debounced ENGINE-side validation of the start FEN while the modal is open.
 * The engine is the only rule authority; when it is offline the FE N is
 * flagged 'unchecked' and is validated again at game start.
 */
function useFenValidation(active, fen, validateFen) {
  // ── State ──
  const [status, setStatus] = useState(FEN_STANDARD);

  // ── Effects ──
  useEffect(() => {
    if (!active) return undefined;
    if (fen === '') { setStatus(FEN_STANDARD); return undefined; }
    if (!validateFen) { setStatus({ state: 'unchecked', reason: 'engine offline — validated at game start' }); return undefined; }
    setStatus({ state: 'checking', reason: null });
    let live = true;
    const timer = setTimeout(() => validateFen(fen)
      .then(r => live && setStatus(r.valid ? { state: 'valid', reason: null } : { state: 'invalid', reason: r.reason }))
      .catch(err => live && setStatus({ state: 'unchecked', reason: err.message })), FEN_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [active, fen, validateFen]);

  return status;
}

/** Filtered option rows (engine catalog + client options), grouped, empty groups dropped. */
function buildGroups(engineReady, query) {
  const matches = (label, key) => query === '' || `${label} ${key}`.toLowerCase().includes(query);
  const rows = [];
  if (engineReady) {
    for (const o of listOptions()) {
      const ui = uiFor(o.uci);
      if (matches(ui.label, o.uci)) rows.push({ kind: 'engine', key: o.uci, o, ui });
    }
  }
  for (const c of CLIENT_OPTIONS) {
    if (matches(c.label, c.id)) rows.push({ kind: 'client', key: c.id, o: c, ui: { ...c, group: 'local', scope: 'client' } });
  }
  return GROUPS.map(g => ({ ...g, rows: rows.filter(r => r.ui.group === g.id) })).filter(g => g.rows.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

const SettingsModal = ({ isOpen, onClose, disabled, engineReady, validateFen }) => {
  // ── State ──
  const [draft, setDraft] = useState(getSettings);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(DEFAULT_EXPANDED);
  const [results, setResults] = useState(null);
  const [saving, setSaving] = useState(false);

  // ── Derived (feeds a hook) ──
  const startFen = (draft.client.startFen || '').trim();
  const fen = useFenValidation(isOpen, startFen, validateFen);

  // ── Effects ──
  // Every opening starts from the committed settings, discarding an abandoned draft.
  useEffect(() => { if (isOpen) { setDraft(getSettings()); setResults(null); } }, [isOpen]);

  if (!isOpen) return null;

  // ── Derived ──
  const base = engineReady ? profileValues(draft.profile) : {};
  const query = filter.trim().toLowerCase();
  const groups = buildGroups(engineReady, query);
  const profiles = engineReady ? listProfiles() : [{ name: draft.profile, label: draft.profile }];
  const overrideKeys = Object.keys(draft.overrides);

  // ── Draft access ──
  const valueOf = (r) => (r.kind === 'client'
    ? (draft.client[r.key] ?? r.o.def)
    : (r.key in draft.overrides ? draft.overrides[r.key] : base[r.key]));

  /** Engine values equal to the profile value are not stored as overrides. */
  const setValue = (r, v) => setDraft(prev => {
    if (r.kind === 'client') return { ...prev, client: { ...prev.client, [r.key]: v } };
    const overrides = { ...prev.overrides };
    if (v === base[r.key]) delete overrides[r.key]; else overrides[r.key] = v;
    return { ...prev, overrides };
  });

  const revert = (r) => setDraft(prev => { const o = { ...prev.overrides }; delete o[r.key]; return { ...prev, overrides: o }; });
  const selectProfile = (name) => setDraft(prev => ({ ...prev, profile: name, overrides: keepSession(prev.overrides) }));
  const resetToProfile = () => setDraft(prev => ({ ...prev, overrides: keepSession(prev.overrides) }));
  const toggleGroup = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  // ── Actions ──
  const save = async () => {
    if (fen.state === 'invalid') { setResults([{ engine: 'start FEN', ok: false, error: fen.reason }]); return; }
    setSaving(true);
    const res = await commitSettings(draft);
    setSaving(false);
    if (res.every(r => r.ok)) { onClose(); return; }
    setResults(res);
  };

  const exportJson = () => downloadJson(normalizeSettings(draft), 'chess-master-config.json');

  const importJson = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { setDraft(normalizeSettings(JSON.parse(String(reader.result)))); }
      catch (err) { console.warn('[settings] import failed:', err); }
    };
    reader.readAsText(file);
  };

  // ── Render helpers ──
  const renderControl = (r) => {
    const v = valueOf(r);
    switch (r.o.type) {
      case 'check':
        return (
          <button onClick={() => setValue(r, !v)} disabled={disabled}
            className={`px-3 py-1 rounded text-xs font-medium ${v ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'} disabled:opacity-50`}>
            {v ? 'ON' : 'OFF'}
          </button>
        );
      case 'combo':
        return (
          <select value={v} onChange={e => setValue(r, e.target.value)} disabled={disabled} className="bg-gray-600 text-white rounded text-xs p-1">
            {r.o.vars.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        );
      case 'fen': {
        const preset = FEN_PRESETS.find(p => p.fen === v);
        const [chipClass, chipText] = FEN_CHIP[fen.state];
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
              <span className={`px-2 py-0.5 rounded ${chipClass}`}>{chipText}</span>
              {fen.reason && <span className="text-gray-400 font-mono">{fen.reason}</span>}
            </div>
          </div>
        );
      }
      default: {
        // spin: slider + number box sharing one value
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
      }
    }
  };

  const renderRow = (r) => {
    const overridden = r.kind === 'engine' && r.key in draft.overrides;
    const meta = (
      <div className="min-w-0">
        <div className="text-gray-300 text-sm flex flex-wrap items-center gap-2">
          {r.ui.label}
          {r.ui.scope === 'session' && <span className="text-[10px] px-1 rounded bg-gray-700 text-gray-400">session</span>}
          {overridden && (
            <button onClick={() => revert(r)} disabled={disabled} className="text-amber-400 text-xs hover:text-amber-300"
              title="Revert to profile value">
              override ↺ <span className="text-gray-500">(profile: {show(base[r.key])})</span>
            </button>
          )}
        </div>
        {r.kind === 'engine' && <div className="text-gray-600 text-xs font-mono">{r.key}</div>}
        {r.ui.help && <div className="text-gray-500 text-xs mt-1">{r.ui.help}</div>}
        {r.key === 'SearchStrategy' && <div className="text-gray-400 text-xs mt-1">{STRATEGY_HELP[valueOf(r)]}</div>}
      </div>
    );
    // The FEN editor needs the full width, so it stacks under its label.
    return r.o.type === 'fen'
      ? <div key={r.key} className="space-y-2">{meta}{renderControl(r)}</div>
      : <div key={r.key} className="flex items-start justify-between gap-3">{meta}<div className="flex-shrink-0">{renderControl(r)}</div></div>;
  };

  // ── Render ──
  const headerExtra = (
    <>
      {/* Notices */}
      {disabled && <div className="p-2 bg-yellow-900 rounded text-yellow-200 text-sm text-center">Settings locked during active game</div>}
      {!engineReady && <div className="p-2 bg-gray-700 rounded text-gray-300 text-xs">Engine not connected — engine options appear once it is.</div>}

      {/* Profile */}
      <div className="flex items-center gap-2">
        <label className="text-gray-300 text-sm">Profile</label>
        <select value={draft.profile} disabled={disabled || !engineReady} onChange={e => selectProfile(e.target.value)}
          className="bg-gray-600 text-white rounded text-sm p-1">
          {profiles.map(p => <option key={p.name} value={p.name}>{p.label}</option>)}
        </select>
      </div>

      {/* Filter + import/export */}
      <div className="flex items-center gap-2">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter options…"
          className="flex-1 bg-gray-700 text-white rounded p-2 text-sm" />
        <button onClick={exportJson} className="px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs">Export</button>
        <label className="px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs cursor-pointer">
          Import<input type="file" accept="application/json" onChange={importJson} className="hidden" />
        </label>
      </div>

      {/* Override summary */}
      <div className="text-xs text-gray-400">
        {overrideKeys.length === 0 ? `Running ${draft.profile} as-is.` : `${overrideKeys.length} override(s): ${overrideKeys.join(', ')}`}
      </div>
    </>
  );

  const footer = (
    <>
      {/* Sync failures */}
      {results && (
        <div className="mb-3 p-2 rounded bg-red-900 text-red-200 text-xs space-y-1">
          {results.map((r, i) => (
            <div key={i} className="font-mono">{r.engine}: {r.ok ? `ok (${r.changes} change(s), cfg ${r.hash ?? '-'})` : r.error}</div>
          ))}
          <div className="text-red-300">Settings are saved locally and re-sent on the next connection.</div>
        </div>
      )}
      {/* Actions */}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={resetToProfile} disabled={disabled}>Reset to profile</Button>
        <Button className="flex-1" onClick={() => setDraft(emptySettings())} disabled={disabled}>Reset all</Button>
        <Button className="flex-1" tone="primary" onClick={save} disabled={disabled || saving}>{saving ? 'Applying…' : 'Save & apply'}</Button>
      </div>
    </>
  );

  return (
    <Modal open onClose={onClose} title="Engine Settings" icon="fa-cog" width="w-[40rem]" headerExtra={headerExtra} footer={footer}>
      {groups.map(g => {
        const isExpanded = expanded[g.id] || query !== '';
        return (
          <div key={g.id} className="mb-3 border border-gray-700 rounded">
            <button onClick={() => toggleGroup(g.id)} className="w-full flex justify-between items-center px-3 py-2 bg-gray-700 text-left">
              <span className="text-sm font-bold text-gray-200">{g.label}</span>
              <span className="text-gray-400 text-xs">{g.rows.length} · {isExpanded ? '▾' : '▸'}</span>
            </button>
            {isExpanded && <div className="p-3 space-y-3">{g.rows.map(renderRow)}</div>}
          </div>
        );
      })}
    </Modal>
  );
};

export default SettingsModal;