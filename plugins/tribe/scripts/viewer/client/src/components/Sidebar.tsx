// client/src/components/Sidebar.tsx — the project list, the campaign filter box, and D10's
// "show N older projects" affordance (spec §8.1). Purely compositional: each child owns its own
// behaviour and token set; this component adds none of its own beyond the frame.
import type { Project } from '../../../core/model.ts';
import { CampaignFilter } from './CampaignFilter.tsx';
import { ProjectList } from './ProjectList.tsx';
import { ShowOlderProjects } from './ShowOlderProjects.tsx';

export interface SidebarProps {
  projects: Project[];
  olderCount: number;
  campaignFilter: string;
  onCampaignFilterChange: (value: string) => void;
  /** The `dir` of the project currently being viewed (route `/p/<dir>`), threaded to `ProjectList`
   * so its row shows the active stroke. Omitted on the aggregate `/` list. */
  activeProjectDir?: string | null;
  /** A failed sidebar projects fetch (spec §8.1). Surfaced HERE, inside the sidebar itself, so it
   * is visible on EVERY route the shell renders — including a session route, whose `<main>` never
   * shares the list route's error branch (Item D, phase-3 audit fix). `null`/omitted renders
   * nothing, same as every other optional degraded note in this file family. */
  projectsError?: string | null;
}

export function Sidebar({ projects, olderCount, campaignFilter, onCampaignFilterChange, activeProjectDir, projectsError }: SidebarProps) {
  return (
    <aside className="sidebar">
      <h2 className="sidebar__heading">Projects</h2>
      {projectsError != null && (
        <p className="sidebar-error" data-testid="sidebar-projects-error">
          {projectsError}
        </p>
      )}
      <ProjectList projects={projects} activeProjectDir={activeProjectDir} />
      <CampaignFilter value={campaignFilter} onChange={onCampaignFilterChange} />
      <ShowOlderProjects olderCount={olderCount} />
    </aside>
  );
}
