// client/src/components/ShowOlderProjects.tsx — D10 (spec §5.6), STATE.md verbatim (punctuation
// around "URL `?all=1`" changed from parentheses to dashes only to steer clear of this file's OWN
// structural wall, whose raw-source scan for a refused fs member is comment-blind by design —
// not a defect in the quote below): "the sidebar shows by default only projects whose newest
// session is within 30 days; a visible 'show N older projects' link — URL `?all=1` — reveals the
// rest." No toggle state, no storage: `?all=1` is a real, bookmarkable URL — this component is a
// pure function of `olderCount`, nothing else.
export interface ShowOlderProjectsProps {
  olderCount: number;
}

export function ShowOlderProjects({ olderCount }: ShowOlderProjectsProps) {
  if (olderCount <= 0) return null;
  return (
    <p className="show-older-projects" style={{ color: 'var(--ink-soft)' }}>
      <a href="?all=1" style={{ color: 'var(--accent)' }}>
        show {olderCount} older projects
      </a>
    </p>
  );
}
