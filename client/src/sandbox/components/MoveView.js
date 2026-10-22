import Panel, { KV, Section } from './Panel';
import HeuristicBars from './HeuristicBars';
import { COMPONENTS, COMPONENT_LABEL } from '../model';
import { fmtCp, fmtInt, WHY_LABEL } from '../format';

/** One candidate in depth: search view, ordering view, and its static terms against the played move. */
const MoveView = ({ view, nav, dispatch }) => {
  const { picked, played, turn } = view;
  if (!turn || !picked) return null;
  const ref = played && played !== picked ? played : null;
  const rows = picked.breakdown
    ? COMPONENTS.map(k => ({ key: k, label: COMPONENT_LABEL[k], value: picked.breakdown[k] ?? null,
                             ref: ref && ref.breakdown ? ref.breakdown[k] ?? null : undefined }))
    : [];
  return (
    <Panel title={`Move ${picked.alg}${picked.played ? ' (played)' : ''}`}
      sub={ref ? `vs played ${ref.alg} (grey bars)` : 'static terms after the move, mover POV'}
      right={<button onClick={() => dispatch({ type: 'pick-move', alg: picked.alg })} className="text-gray-400 hover:text-white text-sm">✕</button>}>
      <KV items={[
        ['Search score', `${fmtCp(picked.cp)}${picked.exact === false ? ' (bound)' : ''}`],
        ['Loss vs best', picked.delta === null ? '–' : fmtCp(-picked.delta), picked.delta === 0 ? 'text-green-300' : picked.delta > 120 ? 'text-red-300' : 'text-gray-100'],
        ['Final rank', picked.rank === null ? '–' : `#${picked.rank + 1}`],
        ['Ordering rank', picked.orderRank === null ? '–' : `#${picked.orderRank + 1} (${fmtInt(picked.order)})`],
        ['Ordering tier', picked.why ? WHY_LABEL[picked.why] ?? picked.why : '–'],
        ['Nodes under it', fmtInt(picked.nodes)],
        ['Capture / SEE', picked.cap ? `x${picked.cap} / ${picked.see}` : 'no'],
        ['Static after move', fmtCp(picked.staticCp)],
        ['Best at depths', picked.bestAtDepths.length ? picked.bestAtDepths.join(', ') : 'never'],
        ['Source', picked.source ?? '–'],
      ]} />
      <Section title="Evaluation terms (static, after the move)">
        {rows.length > 0 ? <HeuristicBars rows={rows} /> : (
          <div className="text-xs text-gray-500">
            No per-move breakdown for this candidate. Per-move terms come from <span className="font-mono">root-move</span> records in
            <span className="font-mono"> order.ndjson</span> (engine with MOVE_ORDER logging); this candidate is known only from
            <span className="font-mono"> {picked.source}</span>.
          </div>
        )}
      </Section>
    </Panel>
  );
};
export default MoveView;