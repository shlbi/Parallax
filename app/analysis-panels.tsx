'use client';
import {useId, useState} from 'react';
import {Activity, BarChart3, MessageSquare, Send, FileText, TriangleAlert, GitBranch, Check, ScanLine} from 'lucide-react';
import {entities, events, groups, type Connection, type RelationGroup} from './demo-data';
import {replayTelemetry, replayClaimCoverage, replayScorePoints, type ChartPoint} from '@/lib/workspace-regressions';

// Synthetic processing telemetry. These are demo workload samples, not collected records.
const batches = [8, 13, 6, 19, 11, 24, 14, 7, 21, 16, 28, 18];
const laneWeights = [.66, .3, .9, .42, .62, .2, .8, .53];

function AreaChart({points, color = '#c1d5a5', max = 200, label}: {
  points: ChartPoint[]; color?: string; max?: number; label: string;
}) {
  const fillId = useId();
  const safeMax = Math.max(1, max);
  const position = points.map(point => `${point.position * 2.8},${82 - point.value / safeMax * 73}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  return <svg className="analysis-area" viewBox="0 0 280 91" preserveAspectRatio="none" role="img" aria-label={label}>
    <defs><linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".25"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs>
    {[10, 34, 58, 82].map(y => <line key={y} x1="0" y1={y} x2="280" y2={y} stroke="#3d5145" strokeWidth=".5" strokeDasharray="2 4"/>)}
    {first && last && <>
      <polygon points={`${first.position * 2.8},88 ${position} ${last.position * 2.8},88`} fill={`url(#${fillId})`}/>
      <polyline points={position} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke"/>
      <line x1={last.position * 2.8} y1="0" x2={last.position * 2.8} y2="88" stroke={color} strokeWidth=".6" opacity=".5"/>
      <circle className="chart-tracer" cx={last.position * 2.8} cy={82 - last.value / safeMax * 73} r="3" fill={color}/>
    </>}
  </svg>;
}

export function AnalysisPanel({claims, progress, onLens, onReview}: {
  claims: Connection[]; progress: number; onLens: (group: RelationGroup) => void; onReview: () => void;
}) {
  const telemetry = replayTelemetry(progress, batches);
  const {index, total} = telemetry;
  const [scope, setScope] = useState<'case' | 'replay'>('case');
  const coverage = replayClaimCoverage(claims, events, progress);
  const displayed = scope === 'case' ? claims : coverage.highlighted;
  const counts = ['supported', 'review', 'disputed'].map(status => displayed.filter(claim => claim.status === status).length);
  const sum = displayed.length || 1;
  const max = Math.max(...Object.keys(groups).map(group => displayed.filter(claim => claim.group === group).length), 1);

  return <div className="analytics-panel">
    <div className="analysis-title"><span>CASE ANALYTICS</span><span className="telemetry-badge">DEMO REPLAY</span></div>
    <section className="analysis-module">
      <div className="module-head"><h3>Processing activity</h3><Activity size={14}/></div>
      <div className="analysis-kpi"><b>{String(total).padStart(3, '0')}</b><span>sample records<br/><small>SYNTHETIC WORKLOAD</small></span><span className="running-wave"><i/><i/><i/><i/><i/></span></div>
      <AreaChart points={telemetry.points} max={200} label="Synthetic cumulative records through replay"/>
      <div className="chart-axis"><span>09:00</span><span>{events[index].time}</span><span>10:48</span></div>
    </section>
    <section className="analysis-module">
      <div className="module-head"><h3>Relationship mix</h3><GitBranch size={14}/></div>
      <div className="analysis-scope"><button className={scope === 'case' ? 'active' : ''} onClick={() => setScope('case')}>Whole case</button><button className={scope === 'replay' ? 'active' : ''} onClick={() => setScope('replay')}>Timeline highlights</button></div>
      <div className="analysis-bars">{Object.entries(groups).map(([key, group]) => {
        const count = displayed.filter(claim => claim.group === key).length;
        return <button key={key} onClick={() => onLens(key as RelationGroup)} aria-label={`Analyze ${group.name} relationships`}><span>{group.name}</span><div><i style={{width: `${count / max * 100}%`, background: group.color}}/><span className="bar-sweep"/></div><b>{String(count).padStart(2, '0')}</b></button>;
      })}</div>
      {scope === 'replay' && <p className="analysis-footnote" role="status">{coverage.highlighted.length} highlighted claims through the cursor. {coverage.untimed.length} claims have no timeline event; see Whole case. These are selected highlights, not a complete discovery history.</p>}
    </section>
    <section className="analysis-module">
      <div className="module-head"><h3>Evidence health</h3><button onClick={onReview} aria-label="Inspect unresolved claims"><TriangleAlert size={14}/></button></div>
      <div className="evidence-health"><div className="health-ring"><svg viewBox="0 0 110 110" role="img" aria-label={`${counts[0]} supported, ${counts[1]} review, ${counts[2]} disputed claims`}>
        <circle cx="55" cy="55" r="42" stroke="#314636" fill="none" strokeWidth="7"/>
        {counts.map((count, i) => <circle key={i} cx="55" cy="55" r="42" fill="none" stroke={['#bdd2a3', '#c6a56d', '#c4836f'][i]} strokeWidth="7" pathLength="100" strokeDasharray={`${Math.max(0, count / sum * 100 - .7)} 100`} strokeDashoffset={-counts.slice(0, i).reduce((a, b) => a + b, 0) / sum * 100} transform="rotate(-90 55 55)"/>)}
        <circle cx="55" cy="55" r="33" stroke="#536b423a" fill="none" strokeDasharray="1 4"/>
      </svg><b>{Math.round(counts[0] / sum * 100)}<small>%</small></b></div><div className="health-key">{['Supported', 'Review', 'Disputed'].map((label, i) => <button key={label} onClick={onReview}><i style={{background: ['#bdd2a3', '#c6a56d', '#c4836f'][i]}}/><span>{label}</span><b>{counts[i]}</b></button>)}</div></div>
      <span className="analysis-footnote">Current review statuses in this scope · not historical verdicts or identity certainty</span>
    </section>
    <section className="analysis-module source-matrix-module"><div className="module-head"><h3>Source activity</h3><ScanLine size={14}/></div>
      <div className="source-heatmap">{['DOC', 'WEB', 'REL'].map((name, row) => <div key={name}><span>{name}</span>{Array.from({length: 12}, (_, col) => <i key={col} style={{opacity: col <= index ? .2 + ((col * 3 + row * 5) % 7) / 9 : .09, background: col === index ? '#dbdda5' : ['#a1b991', '#88a9ba', '#b59cbe'][row]}}/>)}</div>)}</div>
      <div className="chart-axis"><span>12 SAMPLE WINDOWS</span><span>{events[index].time}</span></div>
    </section>
    <div className="analysis-summary"><Check size={13}/><span>Activity follows replay. Claim summaries use the selected scope.</span></div>
  </div>;
}

export function BottomAnalysis({claims, progress, onSeek}: {claims: Connection[]; progress: number; onSeek: (value: number) => void}) {
  const {index, values, total} = replayTelemetry(progress, batches);
  const [metric, setMetric] = useState<'volume' | 'score'>('volume');
  const scores = events.map(event => claims.find(claim => claim.id === event.relation)?.confidence || 0);
  const selected = metric === 'volume' ? values : scores.map((value, i) => i <= index ? value : 0);
  const ceiling = metric === 'volume' ? 30 : 100;
  const observedScores = scores.slice(0, index + 1);
  return <section className="bottom-analysis">
    <div className="bottom-chart volume-chart"><div className="module-head"><h3><BarChart3 size={12}/>{metric === 'volume' ? 'Source volume' : 'Evidence scores'}</h3><div className="mini-tabs"><button className={metric === 'volume' ? 'active' : ''} onClick={() => setMetric('volume')}>Volume</button><button className={metric === 'score' ? 'active' : ''} onClick={() => setMetric('score')}>Scores</button></div></div>
      <div className="equalizer-chart" role="img" aria-label={metric === 'volume' ? 'Synthetic record volume through replay' : 'Evidence score by replay event'}>{Array.from({length: 48}, (_, i) => {
        const bin = Math.floor(i / 4);
        const value = selected[bin] * (metric === 'volume' ? laneWeights[i % 8] : 1);
        return <button key={i} title={`${events[bin].time} · ${bin > index ? 'Not reached' : metric === 'volume' ? 'Sample records' : `Score ${scores[bin]}%`}`} aria-label={`Inspect analysis window ${i + 1} at ${events[bin].time}`} onClick={() => onSeek((bin + .1) / 12 * 100)} className={bin === index ? 'current' : ''} style={{height: `${Math.max(3, value / ceiling * 100)}%`, background: bin > index ? '#85a987' : metric === 'score' && scores[bin] < 60 ? '#c28b72' : bin === index ? '#d2dba9' : '#85a987', opacity: bin > index ? .14 : 1}}/>;
      })}<span className="chart-scan" style={{left: `${progress}%`}}/></div>
      <div className="chart-axis"><span>09:00</span><span>{metric === 'volume' ? `${total} SYNTHETIC RECORDS` : 'DEMONSTRATION SCORES'}</span><span>10:48</span></div>
    </div>
    <div className="bottom-chart score-trend"><div className="module-head"><h3>Evidence trend</h3><b>{scores[index]}<small>%</small></b></div>
      <AreaChart points={replayScorePoints(scores, progress)} max={100} color="#93b9c3" label="Evidence score at highlighted events through replay"/>
      <div className="chart-axis"><span>LOW {Math.min(...observedScores)}</span><span>{events[index].type.toUpperCase()}</span><span>HIGH {Math.max(...observedScores)}</span></div>
    </div>
    <div className="bottom-chart review-stack"><div className="module-head"><h3>Review queue · whole case</h3><TriangleAlert size={12}/></div>
      <div className="review-towers">{['supported', 'review', 'disputed'].map((status, i) => {
        const count = claims.filter(claim => claim.status === status).length;
        return <div key={status}><b>{String(count).padStart(2, '0')}</b><div>{Array.from({length: 10}, (_, j) => <i key={j} style={{opacity: j < count / (claims.length || 1) * 10 ? 1 : .12, background: ['#afc895', '#c8ac76', '#c48975'][i]}}/>)}</div><span>{['CLEAR', 'OPEN', 'CONFLICT'][i]}</span></div>;
      })}</div>
    </div>
  </section>;
}
type Message={role:'user'|'assistant';text:string;sources:string[]};
export function AskPanel({claims,selectedId,onClaim}:{claims:Connection[];selectedId:string;onClaim:(id:string)=>void}){
 const [input,setInput]=useState('');const [messages,setMessages]=useState<Message[]>([]);const selected=entities.find(e=>e.id===selectedId)!;
 function ask(question:string){if(!question.trim())return;const lower=question.toLowerCase();const local=claims.filter(c=>c.from===selectedId||c.to===selectedId);let sources:string[]=[];let answer='';
 if(/conflict|uncertain|review|disput/.test(lower)){const open=claims.filter(c=>c.status!=='supported');sources=open.slice(0,3).map(c=>c.id);answer=`${open.length} claims need review in this demo. The friendship claim between Alex and Maya is separate from their supported co-authorship. Publication and attendance claims also have unresolved evidence. Inspect the linked claims before drawing a conclusion.`;}
 else if(/family|mother|sibling|parent/.test(lower)){const family=claims.filter(c=>c.group==='family');sources=family.map(c=>c.id);answer='The sample family declaration records Elena as Alex’s mother and Jamie as Alex’s sibling. These are explicit statements in REL-01. They are not conclusions drawn from surnames, pictures or proximity.';}
 else if(/source|record|evidence/.test(lower)){sources=local.slice(0,3).map(c=>c.id);answer=`${selected.name} has ${local.length} relationship claims in the fixture, backed by ${new Set(local.map(c=>c.source)).size} source references. Each source link opens the excerpt, evidence score and review state. The chart workload is synthetic telemetry, separate from these evidence records.`;}
 else {sources=local.slice(0,3).map(c=>c.id);answer=`${selected.name} is connected through ${local.length} claims in the fictional case. ${local.filter(c=>c.status==='supported').length} are supported and ${local.filter(c=>c.status!=='supported').length} need review. Use the relationship lenses to isolate family, social, professional and place connections. A graph path establishes a chain of claims; it does not prove a new personal relationship.`;}
 setMessages(m=>[...m,{role:'user',text:question,sources:[]},{role:'assistant',text:answer,sources}]);setInput('');
 }
 return <div className="ask-panel"><div className="ask-intro"><div className="ask-logo"><MessageSquare size={20}/></div><h2>Ask PARALLAX</h2><p>Question the case. Inspect the sources.</p><span>LOCAL DEMO RESPONSES · NO MODEL CONNECTED</span></div><div className="ask-context"><span>CONTEXT</span><b>{selected.name}</b></div><div className="ask-conversation">{!messages.length?<><p className="ask-welcome">What would you like to examine?</p>{['Summarize these connections','What evidence is disputed?','Explain the family relationships'].map(q=><button className="ask-suggestion" key={q} onClick={()=>ask(q)}>{q}<MessageSquare size={12}/></button>)}</>:messages.map((m,i)=><div className={`ask-message ${m.role}`} key={i}><span>{m.role==='assistant'?'PARALLAX':'YOU'}</span><p>{m.text}</p>{m.sources.length>0&&<div className="ask-citations">{m.sources.map(id=><button key={id} onClick={()=>onClaim(id)}><FileText size={10}/>{id.toUpperCase()}</button>)}</div>}</div>)}</div><form className="ask-compose" onSubmit={e=>{e.preventDefault();ask(input);}}><textarea aria-label="Ask PARALLAX a question" placeholder="Ask about this case…" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask(input);}}}/><div><span>Answers grounded in demo sources</span><button aria-label="Send question" disabled={!input.trim()}><Send size={14}/></button></div></form></div>;
}
