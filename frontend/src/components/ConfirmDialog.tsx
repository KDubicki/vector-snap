import { useEffect, useId, useRef } from 'react';
import type { ConfirmOptions } from './useConfirm';

/** Modal yes/no question; the safe (cancel) choice has focus. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onClose,
}: ConfirmOptions & { onClose: (confirmed: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => {
        // Escape: close through React state instead of the browser.
        event.preventDefault();
        onClose(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose(false); // backdrop
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={messageId}>{message}</p>
      <div className="actions">
        {/* The safe choice has focus, so Enter never discards anything. */}
        <button type="button" className="secondary" autoFocus onClick={() => onClose(false)}>
          {cancelLabel}
        </button>
        <button type="button" className="primary" onClick={() => onClose(true)}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
