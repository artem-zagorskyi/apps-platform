'use client';

import { useRef, useState } from 'react';
import { Check, FileJson, LoaderCircle, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { Callout } from './callout';
import { DiffList } from './diff-list';

const kb = (bytes) => `${Math.ceil(bytes / 1000)} KB`;

/**
 * Two steps: the file is checked first (nothing is applied), then uploaded.
 * checkAction(text) → { ok, data } | { error }, data: { status: 'ok' | 'unchanged' | 'invalid',
 *   currentVersion, nextVersion, summary, errors: [{ target, message }],
 *   warnings: [{ target, message }], changes: [{ kind, target, detail }] }
 * uploadAction(text) → { ok, data: { status: 'created' | 'unchanged', version } } | { error }
 * successMessage(data): toast after an upload
 */
export function FileCheckUpload({ fileName, maxBytes = 500_000, checkAction, uploadAction, successMessage, hint }) {
  const input = useRef(null);
  const [file, setFile] = useState(null); // { name, text }
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | checking | checked | uploading
  const [drag, setDrag] = useState(false);
  const toast = useToast();

  function reset() {
    setFile(null);
    setResult(null);
    setError(null);
    setPhase('idle');
    // The same file can be chosen again
    if (input.current) input.current.value = '';
  }

  async function pick(chosen) {
    if (!chosen) return;
    reset();
    if (chosen.size > maxBytes) {
      setError(`The file is ${kb(chosen.size)}, the limit is ${kb(maxBytes)}`);
      return;
    }
    const text = await chosen.text();
    setFile({ name: chosen.name, text });
    setPhase('checking');
    try {
      const checked = await checkAction(text);
      if (checked.error) {
        reset();
        setError(checked.error);
        return;
      }
      setResult(checked.data);
      setPhase('checked');
    } catch {
      reset();
      setError('The check failed. Try again.');
    }
  }

  async function upload() {
    setPhase('uploading');
    setError(null);
    try {
      const uploaded = await uploadAction(file.text);
      if (uploaded.error) {
        setError(uploaded.error);
        setPhase('checked');
        return;
      }
      toast.add({ title: successMessage(uploaded.data) });
      reset();
    } catch {
      setError('The upload failed. Try again.');
      setPhase('checked');
    }
  }

  if (!file) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDrag(false);
            pick(event.dataTransfer.files?.[0]);
          }}
          className={cn(
            'flex h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border-[0.0938rem] border-dashed bg-muted px-3 text-center text-[0.8125rem] outline-none transition-colors hover:border-ring focus-visible:border-ring',
            drag ? 'border-ring bg-primary-soft' : 'border-input',
          )}
        >
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Upload className="size-4 text-muted-foreground" />
            Drop <span className="font-mono text-xs">{fileName}</span> here or click to choose
          </span>
          <span className="text-xs text-muted-foreground">
            {hint ?? `JSON, up to ${kb(maxBytes)}. Checked first: nothing changes until you press Upload.`}
          </span>
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => pick(event.target.files?.[0])}
        />
        {error && (
          <p role="alert" className="whitespace-pre-line text-xs font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  const errors = result?.errors ?? [];
  const warnings = result?.warnings ?? [];
  const blocked = result?.status !== 'ok';
  const changes = [
    ...(result?.changes ?? []),
    ...warnings.map((warning) => ({ kind: 'warning', target: warning.target, detail: warning.message })),
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-2.5 bg-muted px-3 py-2.5 text-[0.8125rem]">
        <FileJson className="size-4 text-muted-foreground" />
        <span className="font-mono text-xs font-medium">{file.name}</span>
        {phase === 'checking' ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            Checking…
          </span>
        ) : (
          <>
            {result?.summary && <span className="text-muted-foreground">{result.summary}</span>}
            <span className="ml-auto flex items-center gap-3 text-xs font-medium">
              <span
                className={cn('inline-flex items-center gap-1', errors.length > 0 ? 'text-destructive' : 'text-success')}
              >
                {errors.length > 0 ? (
                  <X className="size-3.5" strokeWidth={2.6} />
                ) : (
                  <Check className="size-3.5" strokeWidth={2.6} />
                )}
                {errors.length} error{errors.length === 1 ? '' : 's'}
              </span>
              {warnings.length > 0 && (
                <span className="text-warning">
                  {warnings.length} warning{warnings.length === 1 ? '' : 's'}
                </span>
              )}
            </span>
          </>
        )}
      </div>

      {result && errors.length > 0 && (
        <div className="border-t border-border bg-destructive-soft px-3 py-2.5">
          <div className="mb-1.5 text-xs font-semibold text-destructive">Fix these before uploading</div>
          <ul className="flex flex-col gap-1">
            {errors.map((problem, index) => (
              <li key={index} className="text-[0.8125rem]">
                <span className="font-mono text-xs font-medium">{problem.target}</span>{' '}
                <span className="text-muted-foreground">· {problem.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result?.status === 'unchanged' && (
        <div className="border-t border-border p-3">
          <Callout title={result.currentVersion ? `Same as the current version v${result.currentVersion}` : 'Same as now'}>
            Nothing to upload.
          </Callout>
        </div>
      )}

      {result && result.status !== 'unchanged' && (
        <div className="border-t border-border">
          <div className="px-3 pt-2.5 text-xs font-semibold text-muted-foreground">
            {result.currentVersion ? `Changes compared to v${result.currentVersion}` : 'Changes'}          
          </div>
          <DiffList items={changes} />
        </div>
      )}

      {error && (
        <p role="alert" className="whitespace-pre-line border-t border-border px-3 py-2 text-xs font-medium text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2.5">
        <Button variant="outline" onClick={reset} disabled={phase === 'uploading'}>
          Cancel
        </Button>
        <Button onClick={upload} disabled={phase !== 'checked' || blocked}>
          {phase === 'uploading' ? 'Uploading…' : result?.nextVersion ? `Upload as v${result.nextVersion}` : 'Upload'}
        </Button>
      </div>
    </div>
  );
}