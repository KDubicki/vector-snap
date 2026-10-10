import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { download } from '../lib/download';
import {
  LIBRARY_FILE_NAME,
  MAX_NAME_LENGTH,
  fragmentColors,
  fragmentSvg,
  libraryFile,
  nextFragmentName,
  parseLibraryFile,
  type Fragment,
} from '../lib/fragments';
import { useAppStore } from '../state/store';
import { useConfirm } from './useConfirm';

/** Saved parts of designs: save the selection, manage fragments, back up the library. */
export function FragmentsPanel() {
  const fragments = useAppStore((s) => s.fragments);
  const stored = useAppStore((s) => s.fragmentsStored);
  const selection = useAppStore((s) => s.selection);
  const [name, setName] = useState('');
  const [matchColors, setMatchColors] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const { confirm, dialog } = useConfirm();

  const save = (event: FormEvent) => {
    event.preventDefault();
    const fragment = useAppStore.getState().saveFragment(name);
    if (!fragment) return;
    setName('');
    setMessage({ text: `Saved “${fragment.name}”.` });
  };

  const place = (fragment: Fragment) => {
    useAppStore.getState().placeFragment(fragment, { matchColors });
    setMessage(null);
    // On narrow screens the canvas is above the panel: show where the fragment landed.
    document.querySelector('.editor')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const exportLibrary = () => {
    download(new Blob([libraryFile(fragments)], { type: 'application/json' }), LIBRARY_FILE_NAME);
  };

  const importLibrary = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // the same file can be chosen again
    if (!file) return;
    try {
      const imported = parseLibraryFile(await file.text());
      const added = useAppStore.getState().importFragments(imported);
      const skipped = imported.length - added;
      const count = (n: number) => `${n} ${n === 1 ? 'fragment' : 'fragments'}`;
      setMessage({
        text: added
          ? `Imported ${count(added)}` + (skipped ? ` (${skipped} already in the library).` : '.')
          : `Nothing new: ${count(skipped)} already in the library.`,
      });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), error: true });
    }
  };

  const remove = async (fragment: Fragment) => {
    const confirmed = await confirm({
      title: 'Delete fragment?',
      message: `“${fragment.name}” is removed from the library in this browser.`,
      confirmLabel: 'Delete',
    });
    if (confirmed) useAppStore.getState().deleteFragment(fragment.id);
  };

  return (
    <div className="field fragments">
      <span>Fragments</span>
      {selection.length > 0 ? (
        <form className="fragments__save" onSubmit={save}>
          <input
            type="text"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            placeholder={nextFragmentName(fragments)}
            aria-label="Fragment name"
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="secondary">
            Save selection
          </button>
        </form>
      ) : (
        <p className="hint">
          Select shapes and save them as a fragment to place them on other images later.
        </p>
      )}
      {message && (
        <p
          className={message.error ? 'fragments__warning' : 'hint'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
      {!stored && (
        <p className="fragments__warning" role="alert">
          This browser does not allow storing the library: fragments last until the page is closed.
        </p>
      )}
      {fragments.length > 0 && (
        <>
          <ul className="fragments__list" aria-label="Saved fragments">
            {fragments.map((fragment) => (
              <FragmentItem
                key={fragment.id}
                fragment={fragment}
                onPlace={() => place(fragment)}
                onDelete={() => remove(fragment)}
              />
            ))}
          </ul>
          <div className="checkbox">
            <input
              id="fragment-match-colors"
              type="checkbox"
              checked={matchColors}
              onChange={(event) => setMatchColors(event.target.checked)}
            />
            <label htmlFor="fragment-match-colors">
              Place in this image's nearest colors (no extra filaments)
            </label>
          </div>
        </>
      )}
      <div className="fragments__library">
        <button
          type="button"
          className="link"
          onClick={exportLibrary}
          disabled={fragments.length === 0}
          title="Download the library to back it up or use it in another browser"
        >
          Export library
        </button>
        <label className="link fragments__import">
          Import library…
          <input
            type="file"
            accept=".json,application/json"
            className="visually-hidden"
            onChange={(event) => void importLibrary(event)}
          />
        </label>
      </div>
      {dialog}
    </div>
  );
}

interface FragmentItemProps {
  fragment: Fragment;
  onPlace: () => void;
  onDelete: () => void;
}

function FragmentItem({ fragment, onPlace, onDelete }: FragmentItemProps) {
  const thumbnail = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fragmentSvg(fragment))}`,
    [fragment],
  );
  const colors = fragmentColors(fragment);
  const rename = (input: HTMLInputElement) => {
    const value = input.value.trim();
    // An emptied name is not saved: show the kept name again.
    if (!value) input.value = fragment.name;
    else if (value !== fragment.name) useAppStore.getState().renameFragment(fragment.id, value);
  };

  return (
    <li className="fragment">
      <img className="fragment__thumbnail checkerboard" src={thumbnail} alt="" />
      <div className="fragment__body">
        <input
          // Re-created when the name changes elsewhere (e.g. trimmed by the store).
          key={fragment.name}
          type="text"
          className="fragment__name"
          defaultValue={fragment.name}
          maxLength={MAX_NAME_LENGTH}
          aria-label={`Name of fragment ${fragment.name}`}
          onBlur={(event) => rename(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <span className="hint fragment__meta">
          {fragment.shapes.length} {fragment.shapes.length === 1 ? 'shape' : 'shapes'} ·{' '}
          {colors.length} {colors.length === 1 ? 'color' : 'colors'}
          <span className="fragment__colors" aria-hidden="true">
            {colors.map((color) => (
              <span key={color} className="swatch" style={{ background: color }} />
            ))}
          </span>
        </span>
      </div>
      <div className="fragment__actions">
        <button
          type="button"
          className="secondary"
          aria-label={`Place fragment ${fragment.name} on the image`}
          title="Place on top of the image, centered"
          onClick={onPlace}
        >
          Place
        </button>
        <button
          type="button"
          className="link"
          aria-label={`Delete fragment ${fragment.name}`}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
