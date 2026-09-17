# campaign-badge.e2e.test.ts — commands actually run (Task 32, spec §16.4)

    mkdtemp + git init -b master /var/folders/t2/s0b8z5m947l7kdcvwtrtrt480000gn/T/vc-badge-repo-MfvjBh
    HOME=/var/folders/t2/s0b8z5m947l7kdcvwtrtrt480000gn/T/vc-badge-home-8yEOXM CLAUDE_CONFIG_DIR=/Users/hip/.claude bun /Users/hip/repo/tribe-wt/viewer-consolidation/plugins/tribe/scripts/runner/run.ts --repo /var/folders/t2/s0b8z5m947l7kdcvwtrtrt480000gn/T/vc-badge-repo-MfvjBh --model claude-haiku-4-5-20251001 --home /var/folders/t2/s0b8z5m947l7kdcvwtrtrt480000gn/T/vc-badge-home-8yEOXM/.tribe/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-vc-badge-repo-MfvjBh/campaigns/e2e-campaign-badge --session-timeout 6m --viewer-port 4399 --dry-run
    HOME=/var/folders/t2/s0b8z5m947l7kdcvwtrtrt480000gn/T/vc-badge-home-8yEOXM CLAUDE_CONFIG_DIR=/Users/hip/.claude bun /Users/hip/repo/tribe-wt/viewer-consolidation/plugins/tribe/scripts/runner/run.ts --repo /var/folders/t2/s0b8z5m947l7kdcvwtrtrt480000gn/T/vc-badge-repo-MfvjBh --model claude-haiku-4-5-20251001 --home /var/folders/t2/s0b8z5m947l7kdcvwtrtrt480000gn/T/vc-badge-home-8yEOXM/.tribe/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-vc-badge-repo-MfvjBh/campaigns/e2e-campaign-badge --session-timeout 6m --viewer-port 4399
    (runner exited with code 3)

## Captured stdout lines (verbatim)

    campaign viewer: http://127.0.0.1:4399/?campaign=-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-vc-badge-repo-MfvjBh/e2e-campaign-badge (read-only)
    card C1: http://127.0.0.1:4399/s/440ded79-5552-412e-b3bb-44aab45769cb

sessionId: 440ded79-5552-412e-b3bb-44aab45769cb
repoKeyA: -private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-vc-badge-repo-MfvjBh
repoKeyB: -e2e-campaign-badge-fixture-repo-b
runner exit code: 3
