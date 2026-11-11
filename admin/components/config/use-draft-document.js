'use client';

import { useToast } from '@/components/ui/toast';

const EMPTY = { format_version: 1, holdout: { percent: 0 }, layers: ['default'], parameters: {}, experiments: {} };

/**
 * The document being edited (the draft, or the live version when there is no
 * draft) and a save that turns a change into the draft.
 * save(next, title) resolves to true when saved; title is the success toast.
 */
export function useDraftDocument(overview, saveAction) {
  const toast = useToast();
  const { live, draft } = overview;
  const document = draft?.document ?? live?.document ?? EMPTY;

  async function save(next, title) {
    const result = await saveAction({
      document: next,
      baseVersion: draft ? draft.baseVersion : (live?.version ?? null),
      expectedUpdatedAt: draft?.updatedAt ?? null,
    });
    if (result.error) {
      toast.add({ title: result.error, type: 'error' });
      return false;
    }
    if (title) toast.add({ title });
    return true;
  }

  return { document, save };
}
