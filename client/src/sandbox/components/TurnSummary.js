import Panel, { KV, Section } from './Panel';
import { winProb } from '../model';
import { fmtCp, fmtInt, fmtMs, pct, cap, plyLabel } from '../format';

const pk = (v, nodes) => (nodes > 0 && Number.isFinite(v)) ? (v / nodes * 1000).toFixed(1) : '–';

const TurnSummary = ({ view, session }) => {
  const { turn, frame } = view;
  if (!turn) return null;
  const r = turn.rec;
  const accent = session.accents[turn.eng];
  const engine = session.engines.get(turn.eng);
  const head = (
    <span className={`text-xs font-bold ${accent.text}`}>{turn.eng} · {engine && engine.label ? engine.label : ''}</span>
  );
  const title = `${plyLabel(turn.t)} ${turn.best ?? '?'} — ${cap(turn.color)} to move`;

  if (frame.kind === 'iteration') {
    const it = frame.it;
    return (
      <Panel title={`${frame.title} · ${it.best ?? '?'} ${fmtCp(it.cp)}`} sub={title} right={head}>
        <KV items={[
          ['Best at this depth', it.best ?? '–', it.changed ? 'text-orange-300' : 'text-gray-100'],
          ['Score', fmtCp(it.cp)],
          ['Changed root move', it.changed ? 'yes' : 'no', it.changed ? 'text-orange-300' : 'text-gray-400'],
          ['Nodes this iteration', `+${fmtInt(it.nodesDelta)}`],
          ['Nodes so far', fmtInt(it.nodes)],
          ['Time this iteration', fmtMs(it.ms)],
          ['Elapsed', it.totalMs !== null ? fmtMs(it.totalMs) : '–'],
          ['Seldepth', it.seldepth ?? '–'],
          ['Root orderings', `${it.rootOrders}${it.rootOrders > 1 ? ' (aspiration re-search)' : ''}`],
          ['Sampled traces', String(frame.samples.length)],
        ]} />
        <Section title="Line at this depth"><div className="text-xs font-mono text-gray-200 break-words">{it.pv.join(' ') || '–'}</div></Section>
      </Panel>
    );
  }
  if (frame.kind === 'policy') {
    const p = turn.policy;
    return (
      <Panel title="Root policy" sub={title} right={head}>
        <KV items={[
          ['Search best', turn.rootScores[0] ? `${turn.rootScores[0].alg} ${fmtCp(turn.rootScores[0].score)}` : '–'],
          ['Played', `${turn.best ?? '–'} ${fmtCp(turn.cp, turn.mate)}`, turn.qual ? 'text-orange-300' : 'text-green-300'],
          ['Override cost', turn.qual ? fmtCp(turn.qual) : 'none'],
          ['Root moves verified', String(r.rootVerified ?? 0)],
          ['Repetition avoided', p.repetitionAvoided ? `${p.repetitionAvoided.best} → ${p.repetitionAvoided.played} (cost ${p.repetitionAvoided.cost})` : 'no'],
          ['Tie-break (tension)', p.tieBreak ? `${p.tieBreak.best} → ${p.tieBreak.played} @ ${fmtCp(p.tieBreak.cp)}` : 'no'],
          ['Opening principles', p.openingViolation ? `⚠ ${p.openingViolation.principles}` : 'ok', p.openingViolation ? 'text-yellow-300' : 'text-gray-400'],
        ]} />
        <Section title="Final root ranking (root-scores)">
          <div className="text-xs font-mono space-y-0.5">
            {turn.rootScores.length === 0 && <div className="text-gray-500">not logged (needs MOVE_ORDER)</div>}
            {turn.rootScores.map((s, i) => (
              <div key={s.alg} className={`flex gap-2 ${s.alg === turn.best ? 'text-green-300' : 'text-gray-300'}`}>
                <span className="w-5 text-gray-500">{i + 1}</span><span className="w-14">{s.alg}</span>
                <span className="w-16 text-right">{fmtCp(s.score)}</span><span className="text-gray-500">{s.exact ? 'exact' : 'bound'}</span>
              </div>
            ))}
          </div>
        </Section>
      </Panel>
    );
  }
  if (frame.kind === 'setup') {
    const st = turn.setup;
    return (
      <Panel title="Setup" sub={title} right={head}>
        <KV items={[
          ['Budget', st.start ? `depth ${st.start.maxDepth} · ${fmtMs(st.start.maxMs)} · ${st.start.role}` : '–'],
          ['Stage', st.stage ? `${st.stage.stage} · phase ${Math.round((st.stage.phase ?? 0) * 100)}%` : (turn.stage ?? '–')],
          ['Static eval', fmtCp(turn.staticCp)],
          ['Root moves', `${turn.rootN ?? '–'} (${turn.rootCaps ?? '–'} captures)`],
          ['Book hints', st.book ? `${st.book.count}: ${st.book.top}` : 'none'],
          ['First root ordering', turn.rootOrders[0] ? `${turn.rootOrders[0].top} (score ${fmtInt(turn.rootOrders[0].score)}, n=${turn.rootOrders[0].n})` : '–'],
          ['TT', st.ttInit ? `${st.ttInit.mb}MB · ${fmtInt(st.ttInit.entries)} entries` : (r.ttId ?? '–')],
          ['UCI records in turn', String(turn.uci.length)],
          ['Sampled traces here', String(frame.samples.length)],
        ]} />
      </Panel>
    );
  }
  // result
  const nodes = turn.nodes ?? 0;
  const tt = turn.tt;
  return (
    <Panel title={`Result · ${turn.best ?? '?'} ${fmtCp(turn.cp, turn.mate)}`} sub={title} right={head}>
      <KV items={[
        ['Win probability', turn.cp === null ? '–' : pct(winProb(turn.cp), 1)],
        ['Search best', turn.rootScores[0] ? `${turn.rootScores[0].alg} ${fmtCp(turn.rootScores[0].score)}` : '–'],
        ['Override', turn.qual ? fmtCp(turn.qual) : 'none', turn.qual ? 'text-orange-300' : 'text-gray-400'],
        ['Rank of played', turn.bestRank === null ? '–' : String(turn.bestRank + 1)],
        ['Margin to 2nd', fmtCp(turn.margin)],
        ['Depth / seldepth', `${turn.depth ?? '–'} / ${turn.seldepth ?? '–'}`],
        ['Nodes (q share)', `${fmtInt(nodes)} (${pct(nodes > 0 ? (turn.qnodes ?? 0) / nodes : null)})`],
        ['Time / nps', `${fmtMs(turn.ms)} / ${fmtInt(turn.nps)}`],
        ['Aborted', turn.aborted ?? 'no', turn.aborted ? 'text-red-300' : 'text-gray-400'],
        ['Found at', `d${turn.firstSeenDepth ?? '?'} · ${fmtMs(turn.firstSeenMs)} (${pct(turn.latency)})`],
        ['Root changes', String(turn.rootChanges ?? 0), (turn.rootChanges ?? 0) >= 3 ? 'text-orange-300' : 'text-gray-100'],
        ['Static → search', `${fmtCp(turn.staticCp)} → ${fmtCp(turn.cp, turn.mate)}`],
        ['Stage / phase', `${turn.stage ?? '–'} / ${turn.phase ?? '–'}`],
        ['Material (white)', fmtCp(turn.bal)],
        ['Capture', turn.cap ? `x${turn.cap} · SEE ${turn.capSee}` : 'no'],
        ['Self-reported loss', turn.wpLoss === null ? '–' : pct(turn.wpLoss, 1), turn.wpLoss !== null && turn.wpLoss >= 0.2 ? 'text-red-300' : 'text-gray-100'],
        ['Shuffle', turn.shuffle ? 'yes' : 'no', turn.shuffle ? 'text-purple-300' : 'text-gray-400'],
      ]} />
      <Section title="Ordering & pruning (per 1000 nodes)">
        <KV items={[
          ['First-move cutoff', pct(turn.fmcRate)], ['Cutoffs', fmtInt(r.cutoffs)],
          ['Futility', pk(r.futilityCutoffs, nodes)], ['Null move', pk(r.nullMoveCutoffs, nodes)],
          ['SEE prunes', pk(r.seePrunes, nodes)], ['LMR', `${pk(r.lmrSearches, nodes)} (re ${pk(r.lmrResearches, nodes)})`],
          ['PVS re-search', pk(r.pvsResearches, nodes)], ['Aspiration ↓/↑', `${r.aspLow ?? 0}/${r.aspHigh ?? 0}`],
        ]} />
      </Section>
      <Section title="Transposition table">
        <KV items={[
          ['Hits / cuts', `${fmtInt(r.ttHit)} / ${fmtInt(r.ttCut)}`], ['Hit rate', tt ? tt.hitRate : '–'],
          ['Hit age / depth', `${r.ttAgeAvg ?? '–'} / ${r.ttDepthAvg ?? '–'}`], ['Fill', r.ttFill !== undefined && r.ttFill !== null ? `${(r.ttFill / 10).toFixed(1)}%` : '–'],
        ]} />
      </Section>
      {turn.smp.length > 0 && (
        <Section title="SMP">
          <div className="text-[11px] text-gray-400">{turn.smp.length} smp records · {r.smpStrategy ?? '–'} · threads {r.threads ?? '–'} · pick {r.smpPick ?? '–'} ({r.smpReason ?? '–'})</div>
        </Section>
      )}
    </Panel>
  );
};
export default TurnSummary;