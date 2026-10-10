import { useMemo, useState, type FormEvent } from 'react';
import {
  MAX_NAME_LENGTH,
  fragmentColors,
  fragmentSvg,
  nextFragmentName,
  type Fragment,
} from '../lib/fragments';
import { useAppStore } from '../state/store';
import { useConfirm } from './useConfirm';

/** Saved parts of designs: save the selection, rename and delete fragments. */
export function FragmentsPanel() {
  const fragments = useAppStore((s) => s.fragments);
  const stored = useAppStore((s) => s.fragmentsStored);
  const selection = useAppStore((s) => s.selection);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const save = (event: FormEvent) => {
    event.preventDefault();
    const fragment = useAppStore.getState().saveFragment(name);
    if (!fragment) return;
    setName('');
    setSaved(`Saved “${fragment.name}”.`);
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
      {saved && (
        <p className="hint" role="status">
          {saved}
        </p>
      )}
      {!stored && (
        <p className="fragments__warning" role="alert">
          This browser does not allow storing the library: fragments last until the page is closed.
        </p>
      )}
      {fragments.length > 0 && (
        <ul className="fragments__list" aria-label="Saved fragments">
          {fragments.map((fragment) => (
            <FragmentItem key={fragment.id} fragment={fragment} onDelete={() => remove(fragment)} />
          ))}
        </ul>
      )}
      {dialog}
    </div>
  );
}

function FragmentItem({ fragment, onDelete }: { fragment: Fragment; onDelete: () => void }) {
  const thumbnail = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fragmentSvg(fragment))}`,
    [fragment],
  );
  const colors = fragmentColors(fragment);
  const rename = (value: string) => {
    if (value !== fragment.name) useAppStore.getState().renameFragment(fragment.id, value);
  };

  return (
    <li className="fragment">
      <img className="fragment__thumbnail checkerboard" src={thumbnail} alt="" />
      <div className="fragment__body">
        <input
          // Re-created after a rename, so an emptied name shows the kept one again.
          key={fragment.name}
          type="text"
          className="fragment__name"
          defaultValue={fragment.name}
          maxLength={MAX_NAME_LENGTH}
          aria-label={`Name of fragment ${fragment.name}`}
          onBlur={(event) => rename(event.target.value)}
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
