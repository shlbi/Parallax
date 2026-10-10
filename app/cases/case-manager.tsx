'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, FolderOpen, Plus, RefreshCw, ShieldCheck, Users, LogOut, Clock3, Archive, Trash2 } from 'lucide-react';

type CaseRecord = { id: string; title: string; description: string; kind: 'self' | 'participant' | 'fictional'; state: 'active' | 'archived'; role: 'owner' | 'editor' | 'viewer'; version: number };
type Session = { user: { id: string; username: string }; csrf_token: string };
type Grant = { id: string; participant_reference: string; purpose: string; source_scope: string[]; actions: string[]; status: string; expires_at: number | null; recorded_at: number };
type Member = { user_id: string; username: string; role: string };
type Audit = { seq: number; action: string; at: number; case_version: number };
type Detail = { record: CaseRecord; grants: Grant[]; members: Member[]; events: Audit[]; next_after: number | null };
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export default function CaseManager() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [items, setItems] = useState<CaseRecord[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const csrf = useRef('');
  const requestSequence = useRef(0);
  const busyRef = useRef(false);

  const api = useCallback(async <T,>(path: string, method = 'GET', value?: unknown, version?: number): Promise<T> => {
    const headers: Record<string, string> = {};
    if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-Parallax-CSRF'] = csrf.current; }
    if (version !== undefined) headers['If-Match'] = `"${version}"`;
    const response = await fetch(`/api/core/${path}`, { method, headers, credentials: 'same-origin', cache: 'no-store',
      body: method === 'GET' ? undefined : JSON.stringify(value ?? {}) });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        requestSequence.current++; csrf.current = ''; setSession(null); setItems([]); setDetail(null);
      }
      throw new ApiError(response.status, payload?.error?.message || 'The request failed.');
    }
    return payload as T;
  }, []);

  const loadList = useCallback(async (offset = 0) => {
    const page = await api<{ items: CaseRecord[]; next_offset: number | null }>(`cases?offset=${offset}&limit=40`);
    setItems(old => offset ? [...old, ...page.items] : page.items);
    setNextOffset(page.next_offset);
  }, [api]);

  const openCase = useCallback(async (id: string) => {
    const seq = ++requestSequence.current;
    setDetail(null);
    const record = await api<CaseRecord>(`cases/${id}`);
    const [grants, members, events] = await Promise.all([
      api<{ items: Grant[] }>(`cases/${id}/authorizations`),
      record.role === 'owner' ? api<{ items: Member[] }>(`cases/${id}/members`) : Promise.resolve({ items: [] as Member[] }),
      api<{ items: Audit[]; next_after: number | null }>(`cases/${id}/audit?limit=30`),
    ]);
    if (seq === requestSequence.current) setDetail({ record, grants: grants.items, members: members.items, events: events.items, next_after: events.next_after });
  }, [api]);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'The request failed.'); }
    finally { busyRef.current = false; setBusy(false); }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const found = await api<Session>('session');
        if (!alive) return;
        csrf.current = found.csrf_token; setSession(found);
        await loadList();
      } catch (e) { if (alive && (!(e instanceof ApiError) || e.status !== 401)) setError(e instanceof Error ? e.message : 'Unable to connect.'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; requestSequence.current++; };
  }, [api, loadList]);

  function values(event: FormEvent<HTMLFormElement>) { event.preventDefault(); return new FormData(event.currentTarget); }
  async function changed(path: string, method: string, data: unknown, message: string) {
    if (!detail) return;
    const id = detail.record.id;
    await api(path, method, data, detail.record.version);
    await loadList(); await openCase(id); setNotice(message);
  }

  return <div className="case-home">
    <header className="case-home-header"><a href="/" className="case-wordmark" aria-label="Return to fictional demo">PARALLAX<span>CASE FOUNDATION / 02</span></a><div><a href="/"><ArrowLeft size={15} /> Demo workspace</a>{session && <button disabled={busy} onClick={() => run(async () => {
      await api('session', 'DELETE'); requestSequence.current++; csrf.current = ''; setSession(null); setItems([]); setDetail(null);
    })}><LogOut size={15} /> Sign out</button>}</div></header>
    <main className="case-home-main">
      <div className="case-home-title"><div><span className="case-eyebrow">PERSISTENT WORKSPACE</span><h1>Your cases. Your access.</h1><p>Manage case records, operator permissions, and authorization held offline.</p></div>{session && <span className="case-badge"><ShieldCheck size={14} /> {session.user.username}</span>}</div>
      {error && <div className="case-alert" role="alert">{error}<button disabled={busy} onClick={() => run(async () => { if (session) { await loadList(); if (detail) await openCase(detail.record.id); } else window.location.reload(); })}>Retry / refresh</button></div>}
      {notice && <p className="case-notice" role="status">{notice}</p>}
      {loading ? <p role="status">Connecting to case storage…</p> : !session ? <section className="case-login case-panel">
        <ShieldCheck size={27} /><h2>Operator sign-in</h2><p>Use an operator account created on your backend. This is not participant identity verification.</p>
        <form onSubmit={event => { const data = values(event); const form = event.currentTarget; run(async () => {
          const found = await api<Session>('session', 'POST', { username: data.get('username'), password: data.get('password') });
          csrf.current = found.csrf_token; setSession(found); form.reset(); await loadList();
        }); }}><label>Username<input name="username" required autoComplete="username" maxLength={64} /></label><label>Password<input name="password" type="password" required autoComplete="current-password" maxLength={1024} /></label><button className="case-primary" disabled={busy}>Sign in</button></form>
        <small>No public registration. Account creation and password resets use the backend administration command.</small>
      </section> : <div className="case-manager-grid" aria-busy={busy}>
        <aside className="case-panel case-list"><div className="case-panel-heading"><h2><FolderOpen size={17} /> Case library</h2><button disabled={busy} aria-label="Refresh cases" onClick={() => run(() => loadList())}><RefreshCw size={15} /></button></div>
          <button className="case-primary" disabled={busy} onClick={() => setCreateOpen(v => !v)}><Plus size={15} /> New case</button>
          {createOpen && <form onSubmit={event => { const data = values(event); run(async () => {
            const record = await api<CaseRecord>('cases', 'POST', { title: data.get('title'), description: data.get('description'), kind: data.get('kind') });
            setCreateOpen(false); await loadList(); await openCase(record.id); setNotice('Case saved to the database.');
          }); }}><label>Case title<input name="title" required maxLength={160} /></label><label>Purpose / notes<textarea name="description" maxLength={2000} /></label><label>Case scope<select name="kind" defaultValue="self"><option value="self">My own information</option><option value="participant">Consenting participant</option><option value="fictional">Fictional case</option></select></label><button disabled={busy}>Create case</button></form>}
          <div className="case-items">{items.map(item => <button className={detail?.record.id === item.id ? 'selected' : ''} key={item.id} disabled={busy} onClick={() => run(() => openCase(item.id))}><span>{item.title}</span><small>{item.role} · {item.state} · {item.kind}</small></button>)}{!items.length && <p>No cases yet. Create one to begin.</p>}</div>
          {nextOffset !== null && <button disabled={busy} onClick={() => run(() => loadList(nextOffset))}>Load more cases</button>}
        </aside>
        <section className="case-detail" key={detail ? `${detail.record.id}:${detail.record.version}` : 'empty'}>
          {!detail ? <div className="case-panel case-empty"><FolderOpen size={32} /><h2>Select or create a case</h2><p>Case storage is separate from the fictional graph. Evidence ingestion and graph integration arrive in later batches.</p></div> : <>
            <section className="case-panel"><div className="case-panel-heading"><h2>{detail.record.title}</h2><span className="case-badge">{detail.record.role} / v{detail.record.version}</span></div>
              <form onSubmit={event => { const data = values(event); run(() => changed(`cases/${detail.record.id}`, 'PATCH', { title: data.get('title'), description: data.get('description') }, 'Case details saved.')); }}>
                <fieldset disabled={busy || detail.record.role === 'viewer' || detail.record.state === 'archived'}><label>Title<input name="title" defaultValue={detail.record.title} required maxLength={160} /></label><label>Description<textarea name="description" defaultValue={detail.record.description} maxLength={2000} /></label><button>Save details</button></fieldset>
              </form>
              {detail.record.role === 'owner' && <div className="case-actions"><button disabled={busy} onClick={() => run(() => changed(`cases/${detail.record.id}`, 'PATCH', { state: detail.record.state === 'active' ? 'archived' : 'active' }, 'Case state updated.'))}><Archive size={14} /> {detail.record.state === 'active' ? 'Archive' : 'Restore'}</button><button className="case-danger" disabled={busy} onClick={() => {
                if (window.confirm(`Permanently delete “${detail.record.title}” and its case records, authorizations, membership and audit history? This cannot be undone.`)) run(async () => {
                  await api(`cases/${detail.record.id}`, 'DELETE', {}, detail.record.version); requestSequence.current++; setDetail(null); await loadList(); setNotice('Case deleted from active storage. Backups follow their own retention.');
                });
              }}><Trash2 size={14} /> Delete case</button></div>}
            </section>
            <section className="case-panel"><h2><ShieldCheck size={17} /> Authorization records</h2><p>Signed consent stays with you on paper. Record its scope here—no document upload, scan, or facial verification. This is your authorization record, not independent proof of identity.</p>
              {detail.grants.map(g => <article className="case-record" key={g.id}><div><b>{g.participant_reference}</b><span className={`case-badge ${g.status}`}>{g.status}</span></div><p>{g.purpose}</p><small>Sources: {g.source_scope.join(', ')}<br />Actions: {g.actions.join(', ')}<br />{g.expires_at ? `Expires ${new Date(g.expires_at * 1000).toLocaleString()}` : 'No expiry recorded'}</small>{detail.record.role === 'owner' && g.status !== 'revoked' && <button disabled={busy} onClick={() => {
                const reason = window.prompt('Reason for revoking this authorization:');
                if (reason?.trim()) run(() => changed(`cases/${detail.record.id}/authorizations/${g.id}/revoke`, 'POST', { reason }, 'Authorization revoked.'));
              }}>Revoke</button>}</article>)}
              {!detail.grants.length && <p className="case-muted">No authorization records. {detail.record.kind === 'participant' ? 'Participant processing remains unavailable until its scope is recorded.' : 'This case is labeled as your own information or fictional material.'}</p>}
              {detail.record.role === 'owner' && detail.record.state === 'active' && <details><summary>Record written consent held offline</summary><form onSubmit={event => { const data = values(event); run(() => changed(`cases/${detail.record.id}/authorizations`, 'POST', {
                participant_reference: data.get('participant'), purpose: data.get('purpose'), source_scope: String(data.get('sources')).split('\n').map(s => s.trim()).filter(Boolean),
                actions: data.getAll('actions'), signed_on: data.get('signed_on') || null,
                expires_at: data.get('expires') ? new Date(String(data.get('expires'))).toISOString() : null,
              }, 'Offline authorization recorded. No document was uploaded.')); }}><label>Participant reference<input name="participant" required maxLength={160} placeholder="Name or your reference number" /></label><label>Permitted purpose<textarea name="purpose" required maxLength={2000} /></label><label>Permitted sources, one per line<textarea name="sources" required placeholder="participant-supplied-records" /></label><fieldset className="case-checkboxes"><legend>Permitted actions</legend>{[['case_records', 'Case records'], ['document_analysis', 'Document analysis'], ['image_review', 'Manual image review']].map(([value, label]) => <label key={value}><input type="checkbox" name="actions" value={value} defaultChecked={value === 'case_records'} />{label}</label>)}</fieldset><div className="case-form-pair"><label>Signed on (optional)<input name="signed_on" type="date" /></label><label>Expires (optional, local time)<input name="expires" type="datetime-local" /></label></div><button disabled={busy}>Save authorization record</button></form></details>}
            </section>
            {detail.record.role === 'owner' && <section className="case-panel"><h2><Users size={17} /> Operator access</h2><p>Share with an existing operator account. Participants do not need accounts.</p>{detail.members.map(m => <div className="case-member" key={m.user_id}><span>{m.username}<small>{m.role}</small></span>{m.role !== 'owner' && <button disabled={busy} onClick={() => { if (window.confirm(`Remove ${m.username} from this case?`)) run(() => changed(`cases/${detail.record.id}/members/${m.user_id}`, 'DELETE', {}, 'Operator access removed.')); }}>Remove</button>}</div>)}<form onSubmit={event => { const data = values(event); run(() => changed(`cases/${detail.record.id}/members`, 'PUT', { username: data.get('username'), role: data.get('role') }, 'Operator access saved.')); }}><div className="case-form-pair"><label>Existing username<input name="username" required minLength={3} maxLength={64} /></label><label>Role<select name="role"><option value="viewer">Viewer · read only</option><option value="editor">Editor · edit case details</option></select></label></div><button disabled={busy}>Add / update access</button></form></section>}
            <section className="case-panel"><h2><Clock3 size={17} /> Audit history</h2><p className="case-muted">Saved changes, not simulated activity. Listed oldest first.</p>{detail.events.map(event => <div className="case-audit" key={event.seq}><span>{event.action}<small>Case version {event.case_version}</small></span><time>{new Date(event.at * 1000).toLocaleString()}</time></div>)}{detail.next_after !== null && <button disabled={busy} onClick={() => run(async () => {
              const more = await api<{ items: Audit[]; next_after: number | null }>(`cases/${detail.record.id}/audit?after=${detail.next_after}&limit=30`);
              setDetail(old => old && old.record.id === detail.record.id ? { ...old, events: [...old.events, ...more.items], next_after: more.next_after } : old);
            })}>Load more history</button>}</section>
          </>}
        </section>
      </div>}
    </main><footer className="case-home-footer">BATCH 02 · CASE STORAGE & ACCESS CONTROL<span>Evidence pipelines, AI, and map providers are not connected to these cases yet.</span></footer>
  </div>;
}
