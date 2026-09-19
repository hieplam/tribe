# `tribe` — the command-line entry point

One command for the tribe's local tools. Today it does one thing: start the read-only
[session viewer](../viewer/README.md) and open it in the browser. New options and subcommands
land here, in `core/args.ts`, as they are needed.

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
tribe --version           # the tribe plugin version
tribe --help
```

What happens on `tribe`, modelled on [kanna](https://github.com/cuongtranba/kanna)'s CLI:

| The port… | `tribe` does | exit |
| --- | --- | --- |
| is free | starts the viewer in the foreground, opens the browser once `/healthz` answers; Ctrl-C stops it | the viewer's (0 on Ctrl-C) |
| already runs a tribe viewer | prints its URL, opens the browser, starts nothing | 0 |
| is held by something else | tries the next port, up to 20 ports | 1 if none is free |
| is held and `--strict-port` is set | refuses with one stderr line | 1 |

A bad flag or a missing `--port` value refuses with one stderr line and exit `2`.

## Layout

| File | Role |
| --- | --- |
| `bin/tribe` | the file on PATH: a shebang and one import of `main.ts` |
| `main.ts` | composition root — the only file that reads `process.argv` or exits |
| `core/args.ts` | pure argv parser; every outcome, refusals included, is a returned value |
| `core/viewer.ts` | pure launch flow (reuse / start / next port) over an injected `ViewerIo` |
| `adapters/viewer.adapter.ts` | the world: `/healthz` probe, the foreground child, the browser |

The `/healthz` probe and its classification are the runner's
(`../runner/adapters/viewer-launch.adapter.ts`, `../runner/core/viewer-launch.ts#classifyProbe`),
so the CLI and the campaign runner can never disagree about what counts as a running viewer.

## Tests

```sh
bun install && bun test          # unit tests + tribe.e2e.test.ts (real viewer, bare `tribe` on PATH)
bash ../tests/test-install-cli.sh  # the install hook puts `tribe` on PATH
```
