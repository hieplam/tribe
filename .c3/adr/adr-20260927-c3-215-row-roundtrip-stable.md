---
id: adr-20260927-c3-215-row-roundtrip-stable
c3-seal: 5c251f80758e0feee5959686abfe65b8f5732e36a8ffda359ae471114a6685d8
title: c3-215 escape the note-file globs so the row round-trips
type: adr
goal: |-
    Make c3-215's Change-Safety row "A ruling/ratify session writes outside the campaign home" survive
    a c3x import/export round trip, so `c3x check` passes on a fresh clone (no local c3.db cache).
status: accepted
date: "2026-09-27"
---

## Goal

Make c3-215's Change-Safety row "A ruling/ratify session writes outside the campaign home" survive
a c3x import/export round trip, so `c3x check` passes on a fresh clone (no local c3.db cache).

## Context

On a fresh clone, `c3x check` reports canonical markdown drift on c3-215 (already true on base
9393bb0). The row's text "(answers.md, escalations/*.md, reports/*)" carries an unescaped pair of
asterisks, which the markdown import reads as emphasis and drops; each `c3x repair` re-export
therefore changes the file again, and the committed seal never matches a fresh import.

## Decision

Escape both asterisks (`escalations/\*.md, reports/\*`), the form other c3-215 rows already use for
globs (`rules/\*.md`), which round-trips unchanged. Same meaning, no other edit.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | One Change-Safety row does not round-trip through import/export | c3-215#n2294@v1:sha256:4e71d114681809592f2d956aa1723589edea7279a3f593b91985d6bb29571c08 "A ruling/ratify session writes" | Escape the two glob asterisks |

## Verification

| Check | Result |
| --- | --- |
| c3x check on a fresh clone of the commit | ok: true |
