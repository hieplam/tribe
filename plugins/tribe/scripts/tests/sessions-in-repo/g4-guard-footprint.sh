#!/usr/bin/env bash
# G4 ratchet (card supervisor-sessions-in-repo): the footprint of PR #171's guards.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
cd "$ROOT"
R=plugins/tribe/scripts/runner
FILES=("$R/core/supervisor/home-config.ts" "$R/core/supervisor/home-config.test.ts"
  "$R/core/supervisor/home-config.e2e.test.ts" "$R/core/supervisor/home-config.e2e-guard.test.ts"
  "$R/adapters/home-config.adapter.ts" "$R/adapters/home-config.adapter.test.ts")
lines=0
for f in "${FILES[@]}"; do [[ -f "$f" ]] && lines=$((lines + $(wc -l < "$f"))); done
IDS='isHomeConfigSurface|snapshotHomeConfig|restoreHomeConfig|planHomeConfigRestore|isEmptyRestorePlan|buildHomeConfigWriteHook|HOME_CONFIG_DENIED_REASON|HomeConfigError|home_config_restored|rule-session-cwd-config-restored'
# This script names the identifiers it hunts (the IDS pattern above), so without excluding its own
# path it would count itself and the ratchet's 0 floor would be unreachable no matter how
# completely the guards are deleted.
hits=$(git grep -h -c -E "$IDS" -- plugins .c3/c3-2-plugins .c3/rules .c3/eval \
  ':!plugins/tribe/scripts/tests/sessions-in-repo/g4-guard-footprint.sh' 2>/dev/null | awk '{s+=$1} END {print s+0}')
old=absent; [[ -f .c3/rules/rule-session-cwd-config-restored.md ]] && old=present
new=absent; [[ -f .c3/rules/rule-sessions-start-in-target-repo.md ]] && new=present
C3=$(ls -d ~/.claude/plugins/cache/c3-skill-marketplace/c3-skill/*/skills/c3 | tail -1)
c3=fail; C3X_MODE=agent bash "$C3/bin/c3x.sh" check 2>/dev/null | command grep -q 'ok: true' && c3=ok
echo "guard_files_lines=$lines identifier_hits=$hits old_rule=$old new_rule=$new c3_check=$c3"
