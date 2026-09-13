// client/src/components/ProjectList.tsx — one row per Project (spec §8.1). `ProjectRow` has no
// file of its own (not in this task's Create list) because it is small enough to live as a
// non-exported row renderer inside this file.
import type { Project } from '../../../core/model.ts';
import { LiveDot } from './LiveDot.tsx';

export interface ProjectListProps {
  projects: Project[];
}

/** The label shown for a project row: its own `cwd` when the scan resolved one, else the encoded
 * on-disk directory name (spec §4: "`cwd: string | null` — real cwd read from inside a
 * transcript; null => label with `dir`"). Exported so the fallback rule is directly assertable. */
export function projectLabel(project: Project): string {
  return project.cwd ?? project.dir;
}

function ProjectRow({ project }: { project: Project }) {
  return (
    <li className="project-row" style={{ color: 'var(--ink)' }}>
      <LiveDot live={project.live} />
      <span className="project-row__label">{projectLabel(project)}</span>
      <span className="project-row__count" style={{ color: 'var(--ink-soft)' }}>
        {project.sessionCount} session{project.sessionCount === 1 ? '' : 's'}
      </span>
    </li>
  );
}

export function ProjectList({ projects }: ProjectListProps) {
  return (
    <ul className="project-list">
      {projects.map((project) => (
        <ProjectRow key={project.dir} project={project} />
      ))}
    </ul>
  );
}
