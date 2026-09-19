// client/src/components/ProjectList.tsx — one row per Project (spec §8.1). `ProjectRow` has no
// file of its own (not in this task's Create list) because it is small enough to live as a
// non-exported row renderer inside this file.
import type { Project } from '../../../core/model.ts';
import { LiveDot } from './LiveDot.tsx';

export interface ProjectListProps {
  projects: Project[];
  /** The `dir` of the project currently being viewed (route `/p/<dir>`), or null on the aggregate
   * `/` list. The row whose `dir` matches carries the accent inset stroke (preview §C `.proj.on`).
   * Optional/omitted = nothing is active, exactly as `/` renders. */
  activeProjectDir?: string | null;
}

/** The label shown for a project row: its own `cwd` when the scan resolved one, else the encoded
 * on-disk directory name (spec §4: "`cwd: string | null` — real cwd read from inside a
 * transcript; null => label with `dir`"). Exported so the fallback rule is directly assertable. */
export function projectLabel(project: Project): string {
  return project.cwd ?? project.dir;
}

function ProjectRow({ project, active }: { project: Project; active: boolean }) {
  return (
    <li className={active ? 'project-row project-row--active' : 'project-row'}>
      {/* The status dot: filled when live (LiveDot), a hollow ring when idle (preview §C
          `.dot.idle`). LiveDot renders nothing when idle by design, so the idle ring is its own
          element here rather than a change to LiveDot's contract. */}
      {project.live ? <LiveDot live={true} /> : <span className="idle-dot" aria-hidden="true" />}
      <span className="project-row__label">{projectLabel(project)}</span>
      <span className="project-row__count">
        {project.sessionCount} session{project.sessionCount === 1 ? '' : 's'}
      </span>
    </li>
  );
}

export function ProjectList({ projects, activeProjectDir = null }: ProjectListProps) {
  return (
    <ul className="project-list">
      {projects.map((project) => (
        <ProjectRow key={project.dir} project={project} active={project.dir === activeProjectDir} />
      ))}
    </ul>
  );
}
