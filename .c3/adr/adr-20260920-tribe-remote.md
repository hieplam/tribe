---
id: adr-20260920-tribe-remote
c3-seal: 07d99ed1870ee8704640f373bc254d9bfe3cdbdef4998ef472ad251af045a901
title: tribe-remote
type: adr
goal: 'Let the owner open the session viewer from another device on the same network (a phone, a second laptop) with one flag, `tribe --remote`, exactly as kanna does: `--remote` is a shortcut for `--host 0.0.0.0`, and `--host <address>` binds a given address. There is no password.'
status: done
date: "2026-09-20"
---

## Goal

Let the owner open the session viewer from another device on the same network (a phone, a second laptop) with one flag, `tribe --remote`, exactly as kanna does: `--remote` is a shortcut for `--host 0.0.0.0`, and `--host <address>` binds a given address. There is no password.

## Context

The viewer binds 127.0.0.1 only and its Host/Origin gate accepts only `127.0.0.1` and `localhost`, so no other device can reach it. The owner asked to copy kanna's `--remote` flag (`~/repo/kanna/src/server/cli-runtime.ts`: `--remote` sets host 0.0.0.0; `--password` is a separate optional flag). Asked how access should be guarded — an automatic token, kanna exactly, or kanna plus `--password` — the owner chose kanna exactly: no auth. The viewer serves every Claude Code transcript on the machine, so on the network it is readable by anyone on that network. Two measured facts shape the How: Bun reports a bind to an address that is not this machine's as EADDRINUSE (tried: `10.254.254.254` and `no-such-host.invalid`), the same error as "port in use"; and a `0.0.0.0` bind and a `127.0.0.1` bind coexist on one port (tried), so a localhost probe can find a viewer other devices cannot reach.

## Decision

`serve.ts` gains `--host` (default 127.0.0.1). Before binding it refuses, with exit 2, a host that is not 0.0.0.0, localhost/127.0.0.1, or one of this machine's own IPv4 addresses, so a bad address never reads as "port in use". IPv6 hosts are refused too: they would need bracketed URLs and their own Host rule, and kanna parity does not need them. On a network bind it prints every `http://<LAN-IP>:<port>` URL and a no-password warning. The Host/Origin gate stays a DNS-rebinding defence rather than being removed: on the loopback bind it is unchanged; on a network bind it also accepts any IPv4 literal and any `*.local` name, which is how another device addresses this machine, and still refuses any other DNS name, the shape a rebinding attack needs. This is the one deviation from kanna, and it costs a legitimate user nothing. The decision logic lives in a new pure `core/net.ts`. The `tribe` CLI gains `--remote` and `--host`; it checks for a running viewer at the address the viewer must be reachable on (a LAN address for `--remote`), so a localhost-only viewer is not reused for a network request, and it opens the local URL. The runner's `probeViewer` takes an optional host (default 127.0.0.1), so the CLI keeps using the one `/healthz` reader. The campaign runner's own auto-started viewer stays loopback-only.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | Parent system; one of its surfaces can now be reached from the local network | c3-0#n2@v1:sha256:476cc5f8083fd97a5294182fc94b61a08b26120310802a67bb9869380a9ee31a "Package the Tribe agent ecosystem — the chain-of-command delivery agents and the mechanical done-ness checker that grades their claims — as installable Clau" | Review only: no system goal change |
| c3-2 | container | Parent of c3-215; plugin runtime content, no new plugin or component directory | c3-2#n1781@v1:sha256:fd983e54cededf8ac09a8f391d405e63adfc3a40bfd1e7d560a0a82c175ec7a1 "Plugins own their business logic and runtime assets end-to-end (skill references, helper scripts, templates); nothing here runs at install time except declared " | Review only |
| c3-215 | component | The viewer and tribe command Contract rows change: --host, --remote, the widened Host gate | c3-215#n1787@v1:sha256:f467fd1ec102c55b693524d1b29fda35cba5ac48b31be638a9f6a38cc5b3aef8 "Deliver features through a 5-agent chain of command — Shaman (What/Why) → Warchief (How) → Hunter (TDD execution), gated by Tracker (rules review) and Ski" | Contract rows patched; comply with rule-one-parser-per-edge-shape and rule-temp-dir-cleanup |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-docs-lifecycle | c3-215 cites it; the decision and the owner's ruling are recorded in this ADR and the viewer and CLI READMEs | ref-docs-lifecycle#n1966@v1:sha256:a163534e4fbc98d69ae8cd12167eedff5b0840b29f305b2a4d73a5784501ec2c "Give feature work a durable, ordered paper trail — designs, implementation plans, and proof artifacts must outlive the chat session that produced them. The re" | comply |
| ref-plugin-layout | Inherited through c3-0; no directory is added or installed differently | ref-plugin-layout#n1986@v1:sha256:0282b30a709a0e5b9670cb9130590099375ad4cef2a91521813a7427c3b46c8b "Standardize the directory shape of every plugin so the installer, the marketplace manifest, and the eval harness can walk any plugin without per-plugin logic. T" | N.A - layout unchanged |
| ref-evals-fixture | c3-215 cites it; no role-behavior or skill-trigger eval is touched | ref-evals-fixture#n1976@v1:sha256:6a45601a3dfa6544d9d24b431ead59db2e530db2158f2f706242f30119a20ec8 "One eval fixture format for every role-behavior and skill-trigger eval in the repo — cases shaped as a prompt plus a prose grading rubric — so a single runn" | N.A - no eval fixture added |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-one-parser-per-edge-shape | The CLI reads /healthz and the network interface list, both already read by the runner and the viewer | rule-one-parser-per-edge-shape#n2106@v1:sha256:7c7d98b60ae93f515660d7fdbe87041fceae9207eff813d804c79fe892fbd91f "Every external shape the tribe's TypeScript edges read — a persisted JSON file such as" | comply: probeViewer gains a host parameter; the CLI imports the viewer's lanIPv4Addresses |
| rule-temp-dir-cleanup | New real-server tests create fixture homes | rule-temp-dir-cleanup#n2165@v1:sha256:07c2cffc9bac7195e8f27d6736d323b2833d903277c7e7a3ad4b934b29f4f60d "Every test in this repo that materialises a real temporary directory removes it again, even when" | comply: the existing tmpRoot/afterAll cleanup and afterAll in the e2e test |
| rule-marketplace-registration | Inherited through c3-0; no plugin is added | rule-marketplace-registration#n2069@v1:sha256:e2cde94bfc6a62a4c1b79caf53a11a2bc563c82338b88e7cb3c80bf00a936899 "Every plugin that exists in the tree is discoverable and installable: the marketplace manifest is the authoritative registry, and it must never drift from the " | N.A - manifest unchanged |
| rule-no-squash-merge | c3-215 cites it; this PR lands by regular merge | rule-no-squash-merge#n2084@v1:sha256:2f5ff61964fe9551d508719ff31ed7514dbdbd8d296ff884a7e952a5334fab6a "Every capability in this repo that merges a pull request, or that verifies one was merged," | comply |
| rule-bash-strict-mode | No shell script is touched | rule-bash-strict-mode#n1995@v1:sha256:18b71fb29fad608a0bc7d57da5c807b50c9aafcc827cda25f43fa49e03fbb745 "Every shell script in the repo fails fast and loud: unset variables, failed commands, and broken pipelines abort the script instead of silently producing half-d" | N.A - no .sh change |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Viewer | core/net.ts (bind check, Host rule, LAN list); serve.ts --host, network URLs, warning | plugins/tribe/scripts/viewer/ |
| Runner | probeViewer(port, host = 127.0.0.1) | plugins/tribe/scripts/runner/ports/ports.ts, adapters/viewer-launch.adapter.ts |
| CLI | --remote, --host; probe and open the right address | plugins/tribe/scripts/cli/ |
| Docs | viewer, CLI and plugin READMEs | README.md files |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Auto-generated access token in the LAN URL | Offered as the recommendation; the owner chose kanna's behaviour without auth |
| Remove the Host gate on a network bind, as kanna has none | Any web page the owner visits could then read every transcript through the owner's own browser via DNS rebinding; keeping IPv4 literals and *.local allowed costs a real user nothing |
| Let Bun's bind error speak for a bad --host | Bun reports it as EADDRINUSE, so the viewer would say "port in use" and tribe would walk 20 ports |
| Probe 127.0.0.1 for --remote as before | A localhost-only viewer on the port answers there, would be reused, and the other device still could not connect |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Anyone on the network reads every transcript | Opt-in flag only; the default stays loopback; a warning line on every network start; the CLI help and README say no password | serve.security.test.ts asserts the warning line |
| A future edit widens the default bind | The loopback tests stay, including a LAN-addressed Host refused on the default bind | serve.security.test.ts |

## Verification

| Check | Result |
| --- | --- |
| cd plugins/tribe/scripts/viewer && bun test | 920 tests, 0 fail; --host tests ran against this machine's real LAN address 192.168.100.223 |
| cd plugins/tribe/scripts/cli && bun test | 26 pass, including tribe --remote reachable on the LAN address and a localhost-only viewer not reused |
| cd plugins/tribe/scripts/runner && bun test | 1066 pass; 2 failures in the watchdog G2 file are timing-flaky and unrelated (they pass on rerun) |
