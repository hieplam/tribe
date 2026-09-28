# `tribe` — the command-line entry point

One command for the tribe's local tools: start the read-only
[session viewer](../viewer/README.md) and open it in the browser, or print how a campaign is
doing. New options and subcommands land here, in `core/args.ts`, as they are needed.

## Install

`./install.sh` (repo root) runs the tribe plugin's hook, which links `bin/tribe` to
`~/.local/bin/tribe`. Set `TRIBE_BIN_DIR` to link somewhere else; the hook warns when that
directory is not on `PATH`. The link points into this checkout, so a `git pull` updates the
command with no reinstall. Needs [bun](https://bun.sh) on `PATH`; the viewer's client must be
built, which the same hook does.

## Usage

```sh
tribe                     # start the viewer on 4321 and open http://127.0.0.1:4321/
tribe --port 5000         # start on another port
tribe --no-open           # don't open the browser
tribe --strict-port       # fail if the port is taken instead of trying the next one
tribe --remote            # let your phone/other laptops on the same network open it (no password)
tribe --host 192.168.1.20 # listen on one specific IPv4 address of this machine
tribe --version           # the tribe plugin version
tribe --help
tribe campaign status     # card progress of the campaign you are working on
tribe campaign status <name> [--watch]   # a named campaign; --watch refreshes every 2 s
```

What happens on `tribe`, modelled on [kanna](https://github.com/cuongtranba/kanna)'s CLI:

| The port… | `tribe` does | exit |
| --- | --- | --- |
| is free | starts the viewer in the foreground, opens the browser once `/healthz` answers; Ctrl-C stops it | the viewer's (0 on Ctrl-C) |
| already runs a tribe viewer | prints its URL, opens the browser, starts nothing | 0 |
| is held by something else | tries the next port, up to 20 ports | 1 if none is free |
| is held and `--strict-port` is set | refuses with one stderr line | 1 |

A bad flag or a missing `--port` / `--host` value refuses with one stderr line and exit `2`.

### `--remote`: open it from another device

Kanna's flag, copied as-is: `--remote` is a shortcut for `--host 0.0.0.0`, so the viewer listens
on every network interface. The viewer prints the address to type on the other device:

```
tribe viewer: http://127.0.0.1:4321 (projects root: /Users/you/.claude/projects) — read-only, refresh to update
tribe viewer: on your network at http://192.168.1.20:4321
tribe viewer: no password — any device on this network can read every session transcript
```

**There is no password** — the owner chose kanna's behaviour. Anyone on the same Wi-Fi who finds
the port can read every Claude Code transcript on the machine, so use it on networks you trust.
One protection stays on: the viewer refuses a request addressed by a DNS name other than
`localhost` or `*.local`, so a malicious web page cannot read it through your own browser (DNS
rebinding). Typing the IP address or `<your-mac>.local` works.

`tribe --remote` checks for a running viewer through the LAN address, so a localhost-only viewer
already on the port is not reused (other devices could not reach it); a network one is.

## `tribe campaign status`

What a campaign is doing, read from the two files the campaign runner keeps outside the repo
(`~/.tribe/<repo-key>/campaigns/<name>/campaign-state.json` and `supervisor/status.json`). It
only reads; nothing under `~/.tribe` is ever written. The campaign is found from the repo you are
standing in — any subdirectory works — so there is no path to know:

```sh
$ tribe campaign status post-rdo-followups
campaign post-rdo-followups — terminal (done: campaign_closed)
cards: 2/2 shipped
  fu-closing-dismiss  shipped  tasks 1/1  PR #190  waiting on: —
  rdo-cleanup  shipped  tasks 3/3  PR #191  waiting on: —
last action: exit:campaign_closed (1h ago)
```

Line by line:

| Line | Reads |
| --- | --- |
| header | `campaign <name> — <supervisor state>`, plus ` (<status>: <reason>)` once the campaign has finished, or `supervisor: not started` when no supervisor has run yet |
| `cards: N/M shipped` | how many of the campaign's cards have shipped |
| one line per card | `<id>  <status>  tasks <passed>/<total>  PR #<n>` (or `PR —`), then `waiting on:` the dependencies that have **not** shipped (`—` when nothing is outstanding). `tasks` counts task entries whose `passedSha` the runner has recorded; a campaign whose state file has no task index shows `tasks 0/0` |
| `session: <kind> <card> <session>` | only while a session is running |
| `last action: <action> (<age> ago)` | how long ago the supervisor last did anything |

With no name, the campaign whose state files were touched most recently is the one shown — the
one you are working on. Cards appear in the campaign's planned order, then any card the plan does
not mention, sorted.

**The stuck warning.** A campaign that has not finished and whose supervisor has been quiet for
more than 10 minutes gets a last line:

```
WARNING: possibly stuck — supervisor not updated for 34m
```

A finished campaign is quiet by design and never warns. `--watch` clears the screen and re-reads
both files every 2 seconds — a fixed interval, with no flag to change it; Ctrl-C stops it.

Exit codes:

| Code | When |
| --- | --- |
| `0` | the status was printed |
| `1` | it could not be: you are not inside a git repository, this repo has no campaigns, the name does not exist, or a state file is missing, unreadable or not the shape this command expects — always one line on stderr, never a stack trace |
| `2` | the command line itself is wrong: an unknown flag, a second name, or a name that is not a plain campaign id |

## Layout

| File | Role |
| --- | --- |
| `bin/tribe` | the file on PATH: a shebang and one import of `main.ts` |
| `main.ts` | composition root — the only file that reads `process.argv` or exits |
| `core/args.ts` | pure argv parser; every outcome, refusals included, is a returned value |
| `core/viewer.ts` | pure launch flow (reuse / start / next port, which address to check and open) over an injected `ViewerIo` |
| `core/campaign-status.ts` | pure campaign status: lenient readers for the two state files, which campaign is "latest", the age format, the exact lines printed, and the flow over an injected `CampaignStatusIo` |
| `adapters/viewer.adapter.ts` | the world: `/healthz` probe, the foreground child, the browser |
| `adapters/campaign-status.adapter.ts` | the world: the repo's tribe home (via `../tribe-home.sh`), the campaign directories and their mtimes, reading JSON, the clock, the terminal |

The `/healthz` probe and its classification are the runner's
(`../runner/adapters/viewer-launch.adapter.ts`, `../runner/core/viewer-launch.ts#classifyProbe`),
so the CLI and the campaign runner can never disagree about what counts as a running viewer. The
LAN address list is the viewer's own (`../viewer/core/net.ts#lanIPv4Addresses`). The campaign
home path is `../tribe-home.sh`'s, the single source of truth for `~/.tribe/<repo-key>`, so
`tribe` can never disagree with the runner about where a campaign's state lives.

## Tests

```sh
bun install && bun test          # unit tests + tribe.e2e.test.ts (real viewer, bare `tribe` on PATH)
bash ../tests/test-install-cli.sh  # the install hook puts `tribe` on PATH
```
