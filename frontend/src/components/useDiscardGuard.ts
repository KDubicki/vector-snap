import { useCallback } from 'react';
import { hasUnsavedEdits } from '../state/editorSlice';
import { useAppStore } from '../state/store';
import type { useConfirm } from './useConfirm';

/**
 * Run `action` right away, or — when the SVG has edits that were not downloaded — only
 * after the user confirms discarding them (`reason` says what replaces them).
 */
export function useDiscardGuard(confirm: ReturnType<typeof useConfirm>['confirm']) {
  return useCallback(
    async (action: () => void, reason: string) => {
      if (
        hasUnsavedEdits(useAppStore.getState()) &&
        !(await confirm({
          title: 'Discard your SVG edits?',
          message: `${reason} Download the edited SVG first if you want to keep it.`,
          confirmLabel: 'Discard edits',
          cancelLabel: 'Keep editing',
        }))
      ) {
        return;
      }
      action();
    },
    [confirm],
  );
}
