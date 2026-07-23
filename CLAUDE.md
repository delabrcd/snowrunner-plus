# snowrunner-plus — agent orientation

**SnowRunner+**: a modular modding **framework** for the Havok / Saber "Husky" engine family
that exposes reusable hooks (game + UI) so mod authors don't each re-derive injection, offsets,
overlay, and input plumbing. The **gearbox / RPM / engine-audio mod is the first module**; more
(e.g. MapNav) are planned.

## Where things live (read before working)
The **`wiki/` is the entire source of truth** for project prose (RE facts, design, plans, and
the journal). Start at **`wiki/Home.md`**; the sidebar (`wiki/_Sidebar.md`) indexes everything.
Key pages: `Game-Model`, `Memory-Map`, `RPM-Derivation`, `Audio-Pipeline`, `Input-System`,
`Ghidra-Functions` (RE facts); `SnowRunner-Plus`, `Platform-Roadmap`, `Architecture`,
`Feasibility-and-Plan` (platform/plan); `Changelog` (live state, newest first — keep it
updated); `Open-Problems`, `Speculation`. Everything outside the wiki is **non-prose
artifacts** the wiki references: `docs/evidence/` (samples), `reference/` (binaries, Ghidra
project, logs, tools, reference-mod checkouts), and `tools/` + `mod/` (code).

## How to work here
- **Wiki discipline:** `wiki/` (GitHub-wiki format) holds **only confirmed knowledge** —
  live-validated, decompiled, or first-party documented. Unproven hypotheses / open plans go on
  `wiki/Speculation.md`, never stated as fact on a knowledge page. When you confirm a new RE
  fact, update the relevant `wiki/` page **and** the Ghidra DB label (per the `ghidra-re`
  skill) — don't just log it. The wiki wins over memory on conflicts. Confirmed-only rule: put
  unproven hypotheses/plans on `wiki/Speculation.md`, never as fact on a knowledge page.
- **Core thesis (don't relitigate):** the game has **no usable engine-RPM signal** (its "rpm"
  is a ground-speed-derived cosmetic value) — so we **synthesize** RPM (`wheel_ang_vel /
  gear_ratio`, clamped [idle, redline]) from live physics; we don't rebuild physics.
  Details + what's still open: `wiki/RPM-Derivation.md`, `wiki/Open-Problems.md`.
- This is a leaf git repo under `~/dev/games/`; no shared toolchain.
- The shippable mod is a Windows PE DLL and must be tested under **Proton** (the real target).

## Ground truth
- Install: resolved via `$SR_GAME` (see `.env.local.example`); scripts autodetect Steam
  libraries. Never hardcode or commit an install path.
- AppID `1465360`, runtime **GE-Proton10-34** (Wine). Data lives in `preload/paks/client/*.pak`
  (plain ZIP — read with `python3 -m zipfile`; entry paths use `\` separators).
- Reproducible evidence in `docs/evidence/`; binaries/Ghidra project/tools in `reference/`.
  Feasibility is settled (SteamStub only, no Denuvo/EAC; XAudio2 proxy seam) — see
  `wiki/Feasibility-and-Plan.md`.
