import { useState, type FormEvent } from 'react';
import {
  MAX_PROJECT_NAME,
  findMyProject,
  myProjectSettings,
  removeMyProject,
  saveAsMyProject,
  type MyProject,
} from '../lib/myProjects';
import type { PrintSettings } from '../lib/printPlan';

interface MyProjectsProps {
  projects: MyProject[];
  settings: PrintSettings;
  onApply: (settings: Partial<PrintSettings>, name: string) => void;
  onChange: (projects: MyProject[]) => void;
}

/** Print settings saved under a name in this browser, applied with one click. */
export function MyProjects({ projects, settings, onApply, onChange }: MyProjectsProps) {
  // null: the name form is closed.
  const [name, setName] = useState<string | null>(null);
  const replaces = name !== null && name.trim() !== '' && findMyProject(projects, name);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name?.trim()) return;
    onChange(saveAsMyProject(projects, name, settings));
    setName(null);
  };

  return (
    <div className="my-projects">
      {projects.length > 0 && (
        <ul className="my-projects__list" aria-label="My projects">
          {projects.map((project) => (
            <li key={project.name} className="my-project">
              <button
                type="button"
                className="secondary"
                onClick={() => onApply(myProjectSettings(project), project.name)}
              >
                {project.name}
              </button>
              <button
                type="button"
                className="link"
                aria-label={`Remove ${project.name}`}
                onClick={() => onChange(removeMyProject(projects, project.name))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {name === null ? (
        <button type="button" className="link" onClick={() => setName('')}>
          Save as my project…
        </button>
      ) : (
        <form className="my-projects__form" onSubmit={save}>
          <label htmlFor="my-project-name">Project name</label>
          <input
            id="my-project-name"
            value={name}
            maxLength={MAX_PROJECT_NAME}
            placeholder="e.g. Dog tag"
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="secondary" disabled={!name.trim()}>
            {replaces ? 'Replace' : 'Save'}
          </button>
          <button type="button" className="link" onClick={() => setName(null)}>
            Cancel
          </button>
          <span className="hint">
            Kept in this browser: printer, sizes, base plate and tuning — not the colors’ heights.
          </span>
        </form>
      )}
    </div>
  );
}
