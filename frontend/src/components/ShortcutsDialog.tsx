import { Fragment, useEffect, useId, useRef } from 'react';
import { SHORTCUTS, keyLabel } from '../editor/shortcuts';

/** Modal list of the editor's keyboard shortcuts. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm shortcuts"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose(); // backdrop
      }}
    >
      <h2 id={titleId}>Keyboard shortcuts</h2>
      <div className="shortcuts__groups">
        {SHORTCUTS.map((group) => (
          <section key={group.name}>
            <h3>{group.name}</h3>
            <dl>
              {group.shortcuts.map((shortcut) => (
                <Fragment key={shortcut.action}>
                  <dt>
                    {shortcut.keys.map((combination, index) => (
                      <Fragment key={combination.join('+')}>
                        {index > 0 && <span className="shortcuts__or"> or </span>}
                        {combination.map((key, part) => (
                          <Fragment key={key}>
                            {part > 0 && '+'}
                            <kbd>{keyLabel(key)}</kbd>
                          </Fragment>
                        ))}
                      </Fragment>
                    ))}
                  </dt>
                  <dd>{shortcut.action}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="actions">
        <button type="button" className="primary" autoFocus onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
