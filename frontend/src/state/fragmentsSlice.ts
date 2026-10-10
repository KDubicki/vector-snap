import type { StateCreator } from 'zustand';
import {
  cleanName,
  extractFragment,
  nextFragmentName,
  readFragments,
  saveFragments,
  type Fragment,
} from '../lib/fragments';
import { browserStorage } from '../lib/theme';
import type { AppState } from './store';

/** Library of saved fragments (docs/08-svg-editor.md#fragments). */
export interface FragmentsSlice {
  /** Newest first. Kept when starting with a new image. */
  fragments: Fragment[];
  /** False when the library could not be stored and lasts only until the page closes. */
  fragmentsStored: boolean;
  /** Save the selected shapes as a fragment; returns it, or `null` without a selection. */
  saveFragment: (name?: string) => Fragment | null;
  renameFragment: (id: string, name: string) => void;
  deleteFragment: (id: string) => void;
}

/** Replace the library and store it. */
function store(fragments: Fragment[]): Pick<FragmentsSlice, 'fragments' | 'fragmentsStored'> {
  return { fragments, fragmentsStored: saveFragments(browserStorage(), fragments) };
}

export const createFragmentsSlice: StateCreator<AppState, [], [], FragmentsSlice> = (set, get) => ({
  fragments: readFragments(browserStorage()),
  fragmentsStored: true,

  saveFragment: (name) => {
    const { editor, selection, fragments } = get();
    const fallback = nextFragmentName(fragments);
    const fragment = editor && extractFragment(editor, selection, cleanName(name ?? '', fallback));
    if (!fragment) return null;
    set(store([fragment, ...fragments]));
    return fragment;
  },

  renameFragment: (id, name) =>
    set((state) => {
      const fragments = state.fragments.map((fragment) =>
        fragment.id === id ? { ...fragment, name: cleanName(name, fragment.name) } : fragment,
      );
      return store(fragments);
    }),

  deleteFragment: (id) =>
    set((state) => store(state.fragments.filter((fragment) => fragment.id !== id))),
});
