import { PROJECTS, type ProjectId } from '../lib/printPlan';

interface ProjectPickerProps {
  project: ProjectId;
  onChoose: (id: ProjectId) => void;
}

/** Project presets of the 3D print step (magnet, keychain, …) as selectable cards. */
export function ProjectPicker({ project: current, onChoose }: ProjectPickerProps) {
  return (
    <div className="field">
      <span>Project</span>
      <div className="projects" role="radiogroup" aria-label="Project">
        {PROJECTS.map((project) => (
          <button
            key={project.id}
            type="button"
            role="radio"
            aria-checked={current === project.id}
            className={`project${current === project.id ? ' active' : ''}`}
            onClick={() => onChoose(project.id)}
          >
            <strong>{project.label}</strong>
            <span>{project.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
