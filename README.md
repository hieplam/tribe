# tribe

The Tribe: a chain-of-command agent ecosystem for Claude Code, packaged as installable plugins.
The repo is the single source of truth; `.claude-plugin/marketplace.json` is the authoritative
registry.

> **Repo name.** This repo is being renamed to `hieplam/tribe`; the rename itself lands in a
> follow-up unit of the same campaign, and the commands below already use the new name so they
> are correct the moment it does. Until then the working clone URL is
> `https://github.com/hieplam/todd-skills.git`, and GitHub's rename redirect will keep it working
> afterwards. The seven general-purpose plugins that used to live here now live in
> [`hieplam/agent-plugins`](https://github.com/hieplam/agent-plugins).

## Install

### From any machine (marketplace)

The repo is public, so no clone and no auth are needed:

```
/plugin marketplace add hieplam/tribe
/plugin install tribe@tribe
```

Run those inside a Claude Code session. `tribe@tribe` is `<plugin>@<marketplace>` — the
marketplace is named `tribe`, and any plugin from the table below works in its place.

### From a checkout (symlink install)

Use this on the machine where you edit the plugins. It symlinks them into `~/.claude`, so an
edit here takes effect in every session immediately — there is no marketplace snapshot to
refresh.

```bash
git clone https://github.com/hieplam/tribe.git
cd tribe
./install.sh --list          # show available plugins and their components
./install.sh tribe           # install named plugins
./install.sh                 # install all of them
```

Behaviour: `agents/*.md` link into `~/.claude/agents/`, `skills/<name>/` into
`~/.claude/skills/`. It is idempotent (an existing link to this repo is skipped), a conflicting
file is backed up to `<name>.bak.<epoch>` first, and a plugin's own `install.sh` runs as a
post-install hook. `CLAUDE_DIR` overrides the target root (used by the tests).

The `tribe` plugin's hook also puts the **`tribe` command** on your PATH — a symlink at
`~/.local/bin/tribe` (`TRIBE_BIN_DIR` overrides the directory; the hook warns if it is not on
PATH). Type `tribe` anywhere to start the session viewer and open it in the browser; `tribe
--help` lists the options. See [`plugins/tribe/scripts/cli/`](plugins/tribe/scripts/cli/README.md).

**Which one do I want?** Marketplace to *use* the plugins anywhere; symlink install to *develop*
them.

## Plugins

| Plugin | Kind | What it does |
| --- | --- | --- |
| `tribe` | agents | Six agents under a strict chain of command (Owner ⇄ Shaman ⇄ Warchief ⇄ Hunter, plus Tracker and Skinner reviewers and the read-only Scout code-analyzer). Questions flow up as statuses, decisions flow down as cards and briefs. |
| `verify-shipped` | skills | Mechanically verify a SHIPPED claim against GitHub and git. |

The seven general-purpose plugins this repo used to carry — coverage measurement, testability
refactoring, research-to-post publishing, image-to-video rendering, plan splitting, workflow
journalling, and the explanatory-writing rules — now live in
[`hieplam/agent-plugins`](https://github.com/hieplam/agent-plugins), which lists each of them by
name. Install them from there:

```
/plugin marketplace add hieplam/agent-plugins
/plugin install <name>@agent-plugins
```

## The campaign runner (not installed — run it from a checkout)

`tribe` also ships the **campaign runner**: a stateless CLI that executes staged roadmap cards
unattended — one fresh Agent-SDK executor session per card, script-verified SHIPPED, resumable
after a crash, at zero token cost for the loop itself.

**Installing the `tribe` plugin does not give you a runnable runner.** It lives under
`plugins/tribe/scripts/runner/`, and `scripts/` is repo-invoked, never installed (see
`ref-plugin-layout`) — the runner *dispatches* the tribe rather than being part of the installed
runtime. It also needs its own dependencies, since `node_modules/` is not committed:

```bash
git clone https://github.com/hieplam/tribe.git
cd tribe/plugins/tribe/scripts/runner && bun install && cd -

# always dry-run first — it derives each card's phase from live GitHub with zero side effects
bun plugins/tribe/scripts/runner/run.ts \
  --repo <target-repo> --state <state.json relative to --repo> --model <model> --dry-run
```

Requires [bun](https://bun.sh) and an authenticated `gh`. Every environment value is a CLI
input; the campaign *instance* (state, specs, plans, answers, escalations) lives in the target
repo, never here. See `plugins/tribe/scripts/runner/README.md` for the full input table, resume
semantics, the escalation workflow, and its known limitations.

## Development

```bash
# runner tests
cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit

# `tribe` command tests (needs the viewer built: cd plugins/tribe/scripts/viewer && bun run build)
cd plugins/tribe/scripts/cli && bun install && bun test && bunx tsc --noEmit

# shell script tests (per plugin)
plugins/tribe/scripts/tests/test-validate-plan.sh

# agent/skill evals
python3 scripts/evals/run_evals.py --evals plugins/tribe/evals/evals.json
```

Architecture lives in `.c3/` and is CLI-only — query it with `/c3`, never by hand-editing.
Every plugin in `plugins/` must be registered in `.claude-plugin/marketplace.json`
(`rule-marketplace-registration`), and must follow the directory contract in
`ref-plugin-layout`: `install.sh` only understands `agents/`, `skills/`, `claude-md/`, `hooks/`,
`.claude-plugin/`, `scripts/`, and `evals/`, and warns on anything else.
