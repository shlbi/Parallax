'use client';

import {useEffect, useRef, useState} from 'react';
import {UserRound, AtSign, MapPin, Link2, ImagePlus, FileText, Plus, X, Check, FolderInput, ShieldCheck} from 'lucide-react';
import {
  ATTACHMENT_ACCEPT, normalizeSourceUrl, stageAttachmentMetadata, validateAttachmentBatch,
  type AttachmentMetadata,
} from '@/lib/workspace-regressions';

export type IntakeDraft = {
  name: string; handle: string; address: string; url: string; notes: string;
  files: AttachmentMetadata[]; scope: string;
};

/** The object URL exists only while this preview is mounted. It is never exported. */
function ReferencePreview({file}: {file: File}) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = image.current;
    const source = URL.createObjectURL(file);
    if (element) element.src = source;
    return () => {
      if (element) element.removeAttribute('src');
      URL.revokeObjectURL(source);
    };
  }, [file]);
  // Local blob URLs intentionally use a native image, not the server image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} alt="Selected reference, local preview"/>;
}

export function CaseIntake({onStage, initial}: {onStage: (draft: IntakeDraft) => void; initial: IntakeDraft | null}) {
  const [name, setName] = useState(initial?.name || '');
  const [handle, setHandle] = useState(initial?.handle || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [url, setUrl] = useState(initial?.url || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [scope, setScope] = useState(initial?.scope || 'self');
  const [retained, setRetained] = useState<AttachmentMetadata[]>(() => initial?.files.map(file => ({...file})) || []);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [staged, setStaged] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const previewFile = files.find(file => /\.(jpe?g|png|webp)$/i.test(file.name));
  const attachments = [...retained, ...files];

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const added = Array.from(list);
    try {
      validateAttachmentBatch(retained.length + files.length, added);
      setFiles(current => [...current, ...added]);
      setStaged(false);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add these files.');
    }
  }

  function removeFile(index: number) {
    if (index < retained.length) setRetained(current => current.filter((_, i) => i !== index));
    else setFiles(current => current.filter((_, i) => i !== index - retained.length));
    setStaged(false);
    setError('');
  }

  function submit() {
    try {
      const references = stageAttachmentMetadata(retained, files);
      if (![name, handle, address, url, notes].some(value => value.trim()) && !references.length) {
        throw new Error('Add at least one starting detail or reference file.');
      }
      const sourceUrl = normalizeSourceUrl(url);
      onStage({name, handle, address, url: sourceUrl, notes, scope, files: references});
      setUrl(sourceUrl);
      setStaged(true);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to stage this draft.');
    }
  }

  return <div className="intake-form">
    <div className="intake-banner"><FolderInput size={19}/><div><b>Start with what you have.</b><p>Combine a name, account, source link, reference photo, document or notes.</p></div></div>
    <div className="intake-grid">
      <label><span><UserRound size={13}/>Name or alias</span><input value={name} onChange={event => {setName(event.target.value); setStaged(false);}} placeholder="e.g. Alex Mercer"/></label>
      <label><span><AtSign size={13}/>Username or email reference</span><input value={handle} onChange={event => {setHandle(event.target.value); setStaged(false);}} placeholder="Participant’s known account"/></label>
      <label><span><MapPin size={13}/>Address or place reference</span><input value={address} onChange={event => {setAddress(event.target.value); setStaged(false);}} placeholder="Participant-provided address or public place"/></label>
      <label><span><Link2 size={13}/>Source URL</span><input value={url} onChange={event => {setUrl(event.target.value); setStaged(false);}} placeholder="https://…"/></label>
    </div>
    <label className="intake-notes"><span><FileText size={13}/>Context and notes</span><textarea value={notes} onChange={event => {setNotes(event.target.value); setStaged(false);}} placeholder="What do you already know? Add the source of each detail."/></label>
    <div className="intake-attachments" onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault(); addFiles(event.dataTransfer.files);}}>
      <input ref={picker} type="file" multiple accept={ATTACHMENT_ACCEPT} onChange={event => {addFiles(event.target.files); event.currentTarget.value = '';}} aria-label="Attach participant reference files"/>
      <button onClick={() => picker.current?.click()}><ImagePlus size={23}/><b>Add reference files</b><span>Photos, PDF, text, CSV, JSON · 10 MB per file</span></button>
      {previewFile && <ReferencePreview file={previewFile}/>}
    </div>
    {attachments.length > 0 && <div className="intake-files">{attachments.map((file, index) => <div key={`${file.name}-${index}`}>
      <FileText size={13}/><span>{file.name}<small>{(file.size / 1024).toFixed(0)} KB · {index < retained.length ? 'reference retained · reselect to preview' : 'local selection'}</small></span>
      <button aria-label={`Remove ${file.name}`} onClick={() => removeFile(index)}><X size={13}/></button>
    </div>)}</div>}
    <div className="intake-scope"><ShieldCheck size={16}/><label>Research scope<select value={scope} onChange={event => {setScope(event.target.value); setStaged(false);}}>
      <option value="self">My own information</option><option value="participant">Participant with written consent held offline</option><option value="fictional">A fictional demonstration case</option>
    </select></label></div>
    <p className="intake-explainer">Written consent stays offline. No consent-document upload or biometric verification is required here. A reference image does not independently establish identity. This preview does not run research or upload files.</p>
    {error && <p className="intake-error" role="alert">{error}</p>}
    {staged ? <div className="intake-staged" role="status"><Check size={17}/><span>Input staged for this session.<small>No search has run or files uploaded. File bytes and previews clear when this window closes; reference names, types and sizes remain in the draft.</small></span></div> : <button className="primary-button intake-submit" onClick={submit}><Plus size={15}/>Stage investigation input</button>}
  </div>;
}
