---
name: ghidra-re
description: Reverse-engineer the SnowRunner binary with Ghidra headless in THIS repo. Use whenever decompiling/analyzing SnowRunner.exe, hunting functions/structs/offsets, or chasing an AOB/RVA. Enforces reusing the cached project (never re-import) and PERSISTING every identified function/variable as a confidence-labeled name so knowledge compounds across runs instead of every pass re-deriving `FUN_xxx`.
---

# Ghidra RE for SnowRunner

Static RE runs against a **cached, already-analyzed** Ghidra project. The single most important
rule: **label what you learn back into the project database, with a confidence level**, so the
next pass starts from named functions/vars — not `FUN_6ffffb...`. Analysis is expensive; naming is
cheap and permanent. Every run should leave the project more labeled than it found it.

## The cached program — reuse it, NEVER re-import

The program `snowrunner-fixed.bin` (realigned PE dump: file-offset == RVA) is imported + analyzed in
`reference/ghidra-proj` (project name `snowrunner`, ~706 MB db). Re-importing re-runs full analysis
(~30 min, wasteful). Always `-process ... -noanalysis`:

```bash
export JAVA_HOME=~/.local/opt/jdk-21.0.11+10
REPO="$(git rev-parse --show-toplevel)"           # this checkout
~/.local/opt/ghidra_12.1.2_PUBLIC/support/analyzeHeadless \
  "$REPO/reference/ghidra-proj" snowrunner \
  -process snowrunner-fixed.bin -noanalysis \
  -scriptPath "$REPO/tools/re" \
  -postScript <YourScript>.java
```

- **Never** pass `-import` (re-analyzes) or `-readOnly` (discards your labels). Default `-process` is
  read-write and analyzeHeadless **commits the DB after the post-script**, so `setName`/`createLabel`
  calls persist.
- **One process at a time** holds the project lock. Only one headless run at once; don't launch two.
- Ghidra headless is slow to open the db + decompile. Run it **backgrounded** and wait on completion
  rather than chaining sleeps. Skip decompiling functions > ~24 000 bytes (they hang the decompiler).
- **Addressing:** `RVA = VA - 0x140000000`. The loaded image base is not 0 (reported e.g.
  `0x6ffffa670000`), so in scripts use `currentProgram.getImageBase().add(rva)` and, for a VA string
  address, `base.add(va - 0x140000000)`. Decompiled call targets look like `FUN_6ffffb...`; their RVA
  = `entryPoint - imageBase`.

## MANDATORY: label every identification, with confidence

The moment you're confident enough to *name* a function, global, struct field, param, or local —
persist it. Do not leave a finding only in chat or a doc; put it in the DB.

**Confidence tag** (matches the repo convention — the name literally carries it):

| tag  | meaning | bar |
|------|---------|-----|
| `hi` | high    | cross-validated: 2+ independent signals (AOB + decompile, decompile + live probe, unambiguous string→xref, or a live-confirmed offset) |
| `md` | medium  | a single strong decompile/xref inference; internally consistent but not independently confirmed |
| `lo` | low     | plausible hypothesis / partial; explicitly unverified — still worth naming so the next pass can confirm or kill it |

**How to label (Ghidra API, in a post-script):**

- **Function** → `f.setName("<tag>_<DescriptiveName>", SourceType.USER_DEFINED)` and
  `f.setComment("CONFIDENCE " + TAG + " -- <evidence: what proves it, RVA, date>")`. Descriptive name
  is `PascalCase` or `Subsystem_Action`, e.g. `hi_DrivetrainUpdate_ApplyGear`.
- **Global / data address** → `createLabel(addr, "<tag>_g_Name", true)` (+ a comment via
  `setPlateComment`/`setEOLComment`). Prefix globals `g_`.
- **Struct field / offset semantics** → prefer defining a Ghidra `Structure` (via `DataTypeManager`)
  with field names carrying the tag (e.g. `hi_gear_current` at +0x70) and applying it at the base;
  if that's too heavy for the moment, at minimum `setEOLComment` at the access instruction, e.g.
  `hi TruckAction+0x70 = current gear`.
- **Param / local var** → rename via the decompiler `HighFunction`
  (`HighFunctionDBUtil.updateDBVariable(highSym, newName, null, SourceType.USER_DEFINED)`), or, if
  that's fiddly, drop an `setEOLComment` at the defining instruction. Carry the tag in the name.

**Extend the replayable script.** `tools/re/LabelKnowns.java` is the canonical, idempotent
"apply-everything-we-know" pass (`label(rva, conf, name, evidence)` + `createLabel`). Add your new
findings there as new `label(...)` lines so the whole label set can be re-applied to a fresh db and
is reviewable in git. Then run it once to commit. Don't scatter one-off rename scripts.

**Mirror to docs.** Also record the label + confidence + evidence in
`docs/evidence/memory-offsets.md` (or the relevant `reference/*.md`) so the knowledge is
human-readable, not only in the binary db.

## Reporting

When you report a finding, **state the confidence and the evidence** the same way the label does
("hi — AOB + live GPROBE confirm", "lo — single decompile inference, unverified"). Don't launder a
`lo` hypothesis as fact. If a later pass upgrades/downgrades confidence, update the label's tag and
the `LabelKnowns.java` entry — the tag should always reflect current belief.

## Conventions / gotchas specific to this repo

- Scripts live in `tools/re/*.java`; reuse the patterns in `DecompAddrs.java` (decompile by RVA),
  `DecompCluster.java` (xref callers), `LabelKnowns.java` (persist labels).
- Known anchors: TRUCK_CONTROL global `image+0x2A8EDD8`; Vehicle = `[[TRUCK_CONTROL]+0x08]`;
  TruckAction = `Vehicle+0x68`; gearbox caps `TruckAction+0x58`. Ground-truth offsets:
  `docs/evidence/memory-offsets.md`. Curated exe strings: `docs/evidence/static-re.md`.
- Live validation closes the loop: static RVAs/offsets get confirmed via the Frida harness
  (`tools/dev/`, GPROBE/DIAG). A finding validated live earns `hi`; promote its label.
- Save raw decompiler dumps you rely on to the scratchpad and cite them; keep the concise, labeled
  conclusions in the db + docs.
