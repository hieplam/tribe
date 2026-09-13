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
}

export function Sidebar({ projects, olderCount, campaignFilter, onCampaignFilterChange }: SidebarProps) {
  return (
    <aside className="sidebar" style={{ background: 'var(--surface)', borderColor: 'var(--rule)' }}>
      <ProjectList projects={projects} />
      <CampaignFilter value={campaignFilter} onChange={onCampaignFilterChange} />
      <ShowOlderProjects olderCount={olderCount} />
    </aside>
  );
}
