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
  /** A failed sidebar projects fetch (spec §8.1). Surfaced HERE, inside the sidebar itself, so it
   * is visible on EVERY route the shell renders — including a session route, whose `<main>` never
   * shares the list route's error branch (Item D, phase-3 audit fix). `null`/omitted renders
   * nothing, same as every other optional degraded note in this file family. */
  projectsError?: string | null;
}

export function Sidebar({ projects, olderCount, campaignFilter, onCampaignFilterChange, projectsError }: SidebarProps) {
  return (
    <aside className="sidebar" style={{ background: 'var(--surface)', borderColor: 'var(--rule)' }}>
      {projectsError != null && (
        <p className="sidebar-error" data-testid="sidebar-projects-error" style={{ color: 'var(--warn)' }}>
          {projectsError}
        </p>
      )}
      <ProjectList projects={projects} />
      <CampaignFilter value={campaignFilter} onChange={onCampaignFilterChange} />
      <ShowOlderProjects olderCount={olderCount} />
    </aside>
  );
}
