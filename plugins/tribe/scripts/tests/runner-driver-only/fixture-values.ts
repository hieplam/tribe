// fixture-values.ts — the Go fixture campaign's values, shared by the renderer (render-prompts.ts)
// and the counter (g2-prompts.ts) so an essential is checked against exactly what was rendered.
// Values mirror the fixture repo hieplam/runner-e2e-go at its starting tree 9bb6b22 (card
// runner-driver-only, spec §6).
export const FIXTURE = {
  cardId: 'small-helpers',
  campaign: 'go-after',
  home: '/Users/owner/.tribe/-Users-owner-repo-runner-e2e-go/campaigns/go-after',
  spec: 'docs/specs/2026-09-27-small-helpers.md',
  plan: 'docs/plans/2026-09-27-small-helpers.md',
  firstTaskId: 'T1',
  firstTaskHeading: 'Task 1: `mathx.Sum`',
  secondTaskId: 'T2',
  secondTaskHeading: 'Task 2: `mathx.Max`',
  failingCommand: 'go test ./...',
} as const;
