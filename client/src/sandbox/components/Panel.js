const Panel = ({ title, sub = null, right = null, children, className = '' }) => (
  <div className={`bg-gray-800 rounded-lg p-3 shadow-lg ${className}`}>
    <div className="flex items-baseline justify-between gap-2 border-b border-gray-600 pb-1 mb-2">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-white truncate">{title}</h3>
        {sub && <div className="text-[11px] text-gray-500 truncate">{sub}</div>}
      </div>
      {right}
    </div>
    {children}
  </div>
);
export default Panel;

export const KV = ({ items }) => (
  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
    {items.map(([k, v, cls]) => (
      <div key={k} className="flex justify-between gap-2 border-b border-gray-700/60 py-0.5 min-w-0">
        <span className="text-gray-400 truncate">{k}</span>
        <span className={`font-mono text-right truncate ${cls ?? 'text-gray-100'}`} title={typeof v === 'string' ? v : undefined}>{v}</span>
      </div>
    ))}
  </div>
);

export const Section = ({ title, children }) => (
  <div className="mt-2">
    <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{title}</div>
    {children}
  </div>
);