import { useState, type ReactNode } from 'react';

interface FoldProps {
  title: string;
  /** What the folded options are set to, shown under the title. */
  values: string;
  /** One of the options has an error: the fold opens so it is not hidden. */
  invalid?: boolean;
  children: ReactNode;
}

/** Panel options folded away behind a heading that says what they are set to. */
export function Fold({ title, values, invalid = false, children }: FoldProps) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="field fold"
      open={open || invalid}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {title}
        <span className="fold__values">{values}</span>
      </summary>
      <div className="fold__body">{children}</div>
    </details>
  );
}
