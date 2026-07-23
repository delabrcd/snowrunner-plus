# wiki/ — GitHub-wiki-style RE knowledge base

These are the SnowRunner+ reverse-engineering pages, authored in **GitHub Wiki** format so
they can be pushed to the repo's wiki (`<repo>.wiki.git`) verbatim:

- Flat page files; filename → page title (`Memory-Map.md` → "Memory Map").
- `Home.md` is the landing page; `_Sidebar.md` / `_Footer.md` are the special nav/footer pages.
- Cross-links use `[[Display Text|Page-Name]]` wiki-link syntax.

## Pages

**Platform & product**
| File | Page |
|---|---|
| `Home.md` | Landing + core thesis |
| `SnowRunner-Plus.md` | The framework: hook surface, modules, design rules |
| `Features.md` + `Feature-*.md` | Feature index and one sub-page per feature (status + implementation) |
| `Platform-Roadmap.md` | Full vision: launcher, mod manager, MapNav, design rules, open questions |
| `Architecture.md` | v1 framework/mod split, input service, settings service |
| `Feasibility-and-Plan.md` | Feasibility verdict + the two attack vectors |
| `Distribution-and-Portability.md` | Install contract, ToS posture, Windows/Proton parity |
| `Prior-Art.md` | Duplication sweep, reference mods, licensing |

**RE knowledge** (confirmed facts)
| File | Page |
|---|---|
| `Game-Model.md` | How the game models drivetrain + audio |
| `Memory-Map.md` | Confirmed runtime offsets |
| `RPM-Derivation.md` | Deriving RPM from physics |
| `Audio-Pipeline.md` | Engine sound + shift-clunk internals and hooks |
| `Input-System.md` | Action-hash registry + drivetrain setters |
| `Asset-and-HUD-System.md` | pak/Scaleform assets + HUD map |
| `Ghidra-Functions.md` | Labeled functions: RVA / role / AOB |

**Process & status**
| File | Page |
|---|---|
| `RE-Toolchain.md` | Ghidra + Frida + driving harness + autonomous ops |
| `Open-Problems.md` | Unknowns / next RE targets |
| `Speculation.md` | Unconfirmed hypotheses + proposed confirmations (NOT fact) |
| `Changelog.md` | Project journal, newest first |
| `_Sidebar.md`, `_Footer.md` | Wiki nav/footer |

## The wiki IS the source of truth

The wiki holds **all project prose** — RE facts, design, plans, and the journal. The old
`docs/*.md` were consolidated in and deleted. What remains outside the wiki is **non-prose
artifacts only**, which the wiki references by path:

- `docs/evidence/` — raw samples (`sample-engine.xml`, `sample-gearbox.xml`,
  `sample-truck-sounds.txt`, `exe-strings.txt`, `runtime-env.txt`).
- `reference/` — the binaries (`snowrunner-fixed.bin`, `-dump.bin`), the cached Ghidra project
  (`ghidra-proj/`), analysis logs, tools (`parse_hud_gfx.py`), and reference-mod checkouts.
- `tools/`, `mod/` — the actual code.

When an [[Open Problems|Open-Problems]] item closes, fold the result into the relevant page and
delete it from Open-Problems. Speculation confirmed → move to a knowledge page; disproven →
delete.

## Publishing to the GitHub wiki

The GitHub wiki is a separate git repo. Once the project has a GitHub remote with the wiki
enabled:

```sh
# one-time: create the first page in the GitHub UI so the wiki repo exists, then
git clone https://github.com/<owner>/<repo>.wiki.git /tmp/srp-wiki
cp wiki/*.md /tmp/srp-wiki/
cd /tmp/srp-wiki && git add -A && git commit -m "Sync RE wiki" && git push
```

Until then these live in-repo under `wiki/` and render fine on GitHub as plain Markdown
(the `[[…]]` links only resolve inside an actual wiki, so browse from `Home.md`).
