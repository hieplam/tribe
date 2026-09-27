# campaign-badge.e2e.test.ts — commands actually run (Task 32, spec §16.4)

    mkdtemp + git init -b master /var/folders/yw/qq7jhg792dzblfszsspp9vgr0000gn/T/vc-badge-repo-JROGQ1
    HOME=/var/folders/yw/qq7jhg792dzblfszsspp9vgr0000gn/T/vc-badge-home-c7KoiS CLAUDE_CONFIG_DIR=/Users/hiep/.claude bun /Users/hiep/repo/tribe-wt/runner-driver-only/plugins/tribe/scripts/runner/run.ts --repo /var/folders/yw/qq7jhg792dzblfszsspp9vgr0000gn/T/vc-badge-repo-JROGQ1 --model claude-haiku-4-5-20251001 --home /var/folders/yw/qq7jhg792dzblfszsspp9vgr0000gn/T/vc-badge-home-c7KoiS/.tribe/-private-var-folders-yw-qq7jhg792dzblfszsspp9vgr0000gn-T-vc-badge-repo-JROGQ1/campaigns/e2e-campaign-badge --session-timeout 6m --viewer-port 4399 --dry-run
    HOME=/var/folders/yw/qq7jhg792dzblfszsspp9vgr0000gn/T/vc-badge-home-c7KoiS CLAUDE_CONFIG_DIR=/Users/hiep/.claude bun /Users/hiep/repo/tribe-wt/runner-driver-only/plugins/tribe/scripts/runner/run.ts --repo /var/folders/yw/qq7jhg792dzblfszsspp9vgr0000gn/T/vc-badge-repo-JROGQ1 --model claude-haiku-4-5-20251001 --home /var/folders/yw/qq7jhg792dzblfszsspp9vgr0000gn/T/vc-badge-home-c7KoiS/.tribe/-private-var-folders-yw-qq7jhg792dzblfszsspp9vgr0000gn-T-vc-badge-repo-JROGQ1/campaigns/e2e-campaign-badge --session-timeout 6m --viewer-port 4399
    (runner exited with code 3)

## Captured stdout lines (verbatim)

    campaign viewer: http://127.0.0.1:4399/?campaign=-private-var-folders-yw-qq7jhg792dzblfszsspp9vgr0000gn-T-vc-badge-repo-JROGQ1/e2e-campaign-badge (read-only)
    card C1: http://127.0.0.1:4399/s/33bbbbb6-f267-4cc2-9bf5-ce441538dab1

sessionId: 33bbbbb6-f267-4cc2-9bf5-ce441538dab1
repoKeyA: -private-var-folders-yw-qq7jhg792dzblfszsspp9vgr0000gn-T-vc-badge-repo-JROGQ1
repoKeyB: -e2e-campaign-badge-fixture-repo-b
runner exit code: 3
