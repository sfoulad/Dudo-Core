# `index-incomplete/` — the corpus that cannot be read

**This directory contains DELIBERATELY UNPARSEABLE JSON. Do not fix it.** Two of its files are
malformed on purpose, and repairing either one silently retires the only input that exercises
`GEN_REF_UNRESOLVABLE_INDEX_INCOMPLETE`.

Driven by `packages/testing/suites/contracts/generator-behaviour.ts`. It is never run in place: the
suite copies this tree to a temporary directory and mutates the copy.

## Why it exists

`GEN_REF_UNRESOLVABLE_INDEX_INCOMPLETE` was the newest refusal path in the `0037` generator and
**had never executed.** Its author flagged that against its own code before anyone asked:

> *"until it runs once, it is a code path I reasoned about and nobody has observed."*

A URN that does not resolve means two different things and only one of them is the referring
contract's fault:

| | code | author |
|---|---|---|
| the `$id` is declared **nowhere** | `GEN_UNRESOLVABLE_REF` | `contract` |
| the index **could not read every file** | `GEN_REF_UNRESOLVABLE_INDEX_INCOMPLETE` | `derived` |

Before the split, both were reported as contract deficiencies. On 2026-09-10 one missing comma in
`template-v1.schema.json` produced **six** refusals — one `GEN_SCHEMA_UNREADABLE` and five
`GEN_UNRESOLVABLE_REF` from a contract resolving five URNs into it. **Six contract deficiencies
describing one cause**, and the derived-counting logic that exists to separate causes from effects
did not fire.

## The files

| | |
|---|---|
| `carrier.schema.json` | **unparseable — missing comma.** Declares `urn:dudo:schema:zephyr:1`, textually, on a line nothing can read |
| `carrier.schema.json.repaired` | the same document with the comma. **Not** `*.schema.json`, so neither `buildSchemaIndex` nor `discoverContracts` sees it — both filter on that exact suffix |
| `hollow.schema.json` | **unparseable — trailing comma.** Referenced by nothing. Its job is to be the *unrelated* broken file |
| `referrer/referrer-v1` | resolves a URN that **is** declared, by the file nothing can read |
| `phantom/phantom-v1` | resolves a URN **no file declares**, in any state of this corpus |

**`carrier` and `zephyr` share no token, deliberately.** A refusal is entitled to name the URN it
could not resolve and must **not** name the file it could not read. If the filename and the `$id`
shared a word, no assertion could tell those two apart, and the case would pass on a message that
named the file — `architecture.md` §3c's worst variant, every fact true and the attribution
invented.

**Two different malformations rather than two copies of one.** Two copies of one defect would only
show the count tracking the number of *files*; a missing comma and a trailing comma show it tracking
the number of *unreadable* ones, which is what the message claims.

## The three states the suite drives

```
both unparseable   ->  2 × GEN_REF_UNRESOLVABLE_INDEX_INCOMPLETE, "2 schema file(s) could not be read"
hollow removed     ->  2 × GEN_REF_UNRESOLVABLE_INDEX_INCOMPLETE, "1 schema file(s) could not be read"
corpus repaired    ->  1 × GEN_UNRESOLVABLE_REF (phantom-v1), and referrer-v1 DELIVERED
```

**The third state is not a bonus case.** Deferring a contract finding while the corpus is unreadable
is only the safe direction if the finding comes back; if it did not, an unrelated parse error would
permanently downgrade a real contract defect and the argument would be exactly backwards.

## Why it is here and not under `packages/contracts/**`

`check:schema-parse` parses **every** JSON file under `packages/contracts/**`, referenced or not,
and runs **first** in the gate. A deliberately malformed schema placed there would fail the gate
before any suite ran. The two are complementary and their scopes must not overlap: that check
asserts the real corpus is well-formed; this fixture needs one that is not.

## The `index-incomplete/` level is load-bearing

`cascade/`, `drift/`, `class-ambiguity/` and this tree all sit under `contract-generator/`, and every
tool here walks its root **recursively**. Rooted one level up, the cascade cases would discover this
tree's two contracts and count them. `walk()` skips `generated` and `fixtures` **by name** and would
skip none of these.
