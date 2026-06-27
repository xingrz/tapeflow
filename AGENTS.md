# Working context for agents

`tapeflow` is a **cross-platform desktop GUI** (Windows / Linux / macOS) for merging overlapping
captures of a worn **DV or HDV videotape** into one complete file — **both formats behind one
interface**. It is the graphical front-end to two existing command-line engines; it does not
reinvent the merge and it does not capture from tape.

If you are here to work on the **UI**, read *What it is*, *The unified data model*, and *The UI it
drives* — that last section is the design intent the renderer now realises (the Canvas tape-map,
re-capture sidebar, drag-drop ingest, and export are all built; what remains is refinement). Bind
the UI to the `tapeflow.analysis/1` contract, not to anything engine-specific.

## What it is

The workflow it serves: a dirty tape doesn't read cleanly in one pass, so you capture it several
times (rewind, retry), ending with several overlapping files that each carry some damage. tapeflow:

1. You pick a **working directory** = the captures of **one tape** (one format — a physical tape is
   either DV or HDV, never both).
2. Click **Analyse**. It indexes the captures, works out how they align, and reports whether they
   merge into a complete video — listing every damaged spot that still needs a re-capture, each
   cued by the tape's **SMPTE timecode** (to find it on the deck) and the camera's **wall-clock
   recording time**.
3. You re-capture those spots on an old deck, drop the new files into the working dir (or drag them
   onto the window — tapeflow copies them in and re-analyses), and the re-capture list shrinks.
4. When complete (or you accept the residual unreadable spots), **export** the merged file.

What it explicitly does **not** do:

- **No capture.** Modern hardware can't capture DV/HDV over FireWire; users capture on separate old
  hardware and copy the files over.
- **No reinventing the merge.** The byte-level merge logic lives in the engines (below). tapeflow
  orchestrates, unifies, and visualises — it never re-implements TS/DV handling.

## The load-bearing idea

tapeflow is **a unifier**. Two engines analyse two tape formats and already produce near-isomorphic
results; tapeflow consumes each engine's structured output and **normalises both into one model**
(`tapeflow.analysis/1`) that the UI renders without caring which format it came from. The entire
reason tapeflow exists — "DV and HDV in one interface" — lives in that normalisation step. Keep it
in the sidecar (below); never push format-specific vocabulary up into the renderer, and never push
the unified vocabulary down into an engine.

## The two engines (consumed, never reinvented)

Pulled in as **git submodules under `engines/`, pinned to a commit** (HTTPS, read-only). They stay
independent, standalone projects with their own tests and CLIs.

- **`engines/hdvmerge`** — HDV / Sony MPEG-TS (`.m2t`). This *is* the engine: a byte-level 188-byte
  transport-stream merge, written this way because even `ffmpeg -c copy` strips Sony's private
  `0xA1` AUX stream (the camera's recording timecode). Irreplaceable; do not try to do its job with
  ffmpeg. Caches a per-capture index `<capture>.idx.jsonl`. Repo: https://github.com/xingrz/hdvmerge
- **`engines/dvmerge`** — DV (`.dv`). A thin layer over the external **`dvrescue`** CLI (MIPoPS),
  which does the real DV merge/alignment; dvmerge owns the domain logic around it (abst-vs-tc
  missing-frame detection, span coalescing, coverage) and the report. Caches a merge log under
  `.dvmerge/`. Repo: https://github.com/xingrz/dvmerge

**How tapeflow talks to them: their `--json` contract, never their Markdown.** Each engine has a
`--json` flag (and a `jsonout.analysis(...)` library function) that emits a **faithful dump of its
own model** — `hdvmerge.analysis/1` and `dvmerge.analysis/1`. These are deliberately *not*
normalised; tapeflow normalises them. Do not scrape the human Markdown report, and do not reach into
engine internals (`Plan`/`Report` dataclass fields) — go through `--json`. Each engine has
lock-step tests (`tests/test_jsonout.py`) guarding that contract, because normal CLI use never
exercises it; the submodule pin additionally ensures an engine's future evolution can't reach
tapeflow's build until the pin is deliberately bumped.

## Architecture

```
┌──────────────────────── Electron ────────────────────────┐
│  renderer (Vue 3 + TS)          main (Node)               │
│  · tape-map (Canvas)        ⇄   · pick working dir        │
│  · re-capture sidebar           · drag-drop ingest (fs)   │
│  · completeness verdict         · spawn/own the sidecar   │
│  · export button                · .tapeflow/state.json    │
└────────────────────────────────┬──────────────────────────┘
                  JSON-RPC 2.0 over stdio (NDJSON)
                  requests/responses + progress notifications
┌────────────────────────────────┴──────────────────────────┐
│  engine/  — Python sidecar (PyInstaller-frozen for release) │
│  routes by file extension → imports hdvmerge / dvmerge      │
│  normalises *.analysis/1 → tapeflow.analysis/1             │
│  methods: capabilities · analyze · build · thumbnail        │
└─────────────────────────────────────────────────────────────┘
```

- **Renderer ↔ main**: Electron's normal contextBridge/IPC. The renderer never touches the
  filesystem or the sidecar directly; main brokers everything.
- **main ↔ sidecar**: one long-lived child process, **JSON-RPC 2.0 framed as newline-delimited
  JSON (NDJSON)** on stdin/stdout. Requests get responses; long jobs (indexing a GB capture) stream
  `progress` notifications. stderr is logs. Main owns the process lifecycle (spawn, restart on
  crash, surface errors to the UI).
- **The sidecar imports the engines as Python libraries** (calls `jsonout.analysis`, `build`, etc.)
  and does the format-routing + normalisation. It is the *only* place that knows both engines.
- **`analyze` vs `verify` — two different questions.** `analyze <dir>` is the *best master these
  captures could build*: a frame with a clean copy in **some** capture counts clean (recoverable, so a
  cascaded ffmpeg decode error is discredited against the clean twin). `verify <file>` is *what one
  already-built master is*, **read-only w.r.t. the master**. For **HDV** it re-reads the lone file
  in memory — a conservative lower bound (≤ `analyze`): a complete master reads the same, but past a
  real residual a lone file has no twin to discredit cascaded ffmpeg errors against, so it counts them.
  For **DV** verify re-runs dvrescue's *merge* on the one file — the CSV log a tag needs is a merge
  artifact — with every temp (a full-size throwaway `.dv` + the logs) sent to **system scratch** and
  removed, guarded by a free-space check (≈ the master's size; `TMPDIR` points it at a big volume).
  That reproduces `analyze`'s tag *exactly* (same dvrescue path, no twin-discrediting in play), so DV
  verify is not conservative — it just needs `dvrescue` + scratch where HDV needs neither.
  (Distinct from `verify`: hdvmerge's `verify_build` is the
  build's *own* post-build self-check. It shares the plan-independent parts — duplicate detection and
  AUX/TS soundness, the same code — but its decode/CC check is *plan-aware* (it forgives decode errors
  the plan already explains), so it's exact where the standalone `verify` stays conservative. Both run
  the same single ffmpeg decode; only the context to forgive a cascade differs.)
- **Ownership split:** filesystem, the working dir, drag-drop copy, and workflow state
  (`.tapeflow/state.json`: the re-capture checklist, accepted-unrecoverable spots) belong to
  **Electron main**. Analysis, merge, and thumbnails belong to the **sidecar**. Engine caches live
  under the working dir (`.tapeflow/`, via the engines' `--index-dir` / `--cache-dir`).

## The unified data model: `tapeflow.analysis/1`

The single contract between sidecar and renderer. The sidecar builds it by normalising whichever
engine ran. The UI binds to **this** and nothing else.

```jsonc
{
  "schema": "tapeflow.analysis/1",
  "format": "hdv" | "dv",
  "dir": "/abs/working/dir",
  "fps": 25.0,
  "complete": false,            // every tape position has a clean copy in the output?
  "buildable": true,            // safe to export a merged file now?
  "tape": {                     // the reconstructed whole-tape span (labels, not coordinates)
    "tcStart": "07:00:00:00", "tcEnd": "07:41:10:12",
    "recStart": "2007-01-01 09:00:00", "recEnd": "2007-01-01 09:42:31",
    "durationFrames": 61234, "title": "CLIP"
  },
  "summary": {                  // for the headline verdict
    "recaptureSpots": 3,        // damage[] entries that can be improved/are needed
    "missingFrames": 12,        // frames missing from every capture (worse than dirty)
    "unusedCaptures": 0         // captures that couldn't be placed (their content is NOT in output)
  },
  "captures": [                 // the lanes on the tape-map
    { "tag": "capA", "file": "CLIP-A.m2t",
      "axis": [0, 30100],       // position on an opaque, monotonic tape axis (see note)
      "tcSpan": ["07:00:00:00","07:20:11:03"], "recSpan": ["...","..."],
      "health": [ { "from": 0, "to": 29800, "state": "clean" },
                  { "from": 29800, "to": 30100, "state": "damaged" } ] }
  ],
  "segments": [                 // how the output is assembled, in tape order
    { "tag": "capA", "axis": [0,30100], "tcSpan": ["...","..."], "recSpan": ["...","..."],
      "gapBefore": false } ],   // gapBefore = a real tape discontinuity precedes this segment
  "damage": [                   // THE re-capture list (the actionable core)
    { "id": "d3",
      "kind": "dirty" | "missing",   // dirty = covered but every copy damaged (improvable);
                                     // missing = no capture has it (lost unless re-captured)
      "axis": [18910, 18923],
      "tcStart": "07:12:34:05", "tcEnd": "07:12:34:18",
      "recStart": "2007-01-01 09:12:30", "recEnd": "...",
      "durationFrames": 13,
      "coverage": ["capA","capB"],   // captures with some frame here; [] => nothing to improve on
      "copies": 2,
      "severity": "intra-frame damage" } ],
  "archive": {                  // the completeness "TF tag" (see note); single source for badge + name
    "tag": "(TF99%-3)", "short": "99%-3", "pct": 99, "tier": "yellow",  // tier: green only at a true 100
    "totalSpots": 3, "dirtySpots": 2, "missingSpots": 1,
    "cleanFrames": 60601, "dirtyFrames": 600, "missingFrames": 33 },
  "divergences": [ /* hdv-only: two clean copies disagree byte-wise; review items, optional */ ]
}
```

**Axis semantics (important for the tape-map):** `axis` is an **opaque, monotonic integer
coordinate** along the tape, used only for *relative* layout on the timeline. Its unit differs by
engine (hdvmerge: GOP index; dvmerge: tape frame) and is not directly comparable to
`durationFrames`. **Always label the UI with `tc`/`rec`, never by computing from `axis`.** Precise
frame-accurate axis unification across formats is a known refinement; until then, treat `axis` as
"good enough for drawing bars in order", and `tc`/`rec` as the source of truth for what a position
*is*.

**The archive "TF tag" (`archive`):** a single archival figure for the merged master — *how complete
is this copy* — computed once **in the sidecar** (`normalize._archive`) so the title-bar badge, the
default export name, and the CLI/skill all agree by construction (it used to live only in the
renderer; that copy is gone). Completeness `pct` = the share of tape frames with **no** residual
damage after the merge (a frame with any concealed/missing block is not clean), **floored** so only a
true 100.0% reads as 100. `tag` is the filename marker `(TF<pct>%-<spots>)` — the `TF` prefix and
parens make it greppable and easy to strip — where `-<spots>` is the residual spot count (`dirty +
missing`), dropped at zero. `tier` keys the badge colour: `green` only at a true 100 (zero residual),
`yellow` ≥ 90, `red` below. The renderer reads `analysis.archive` (never recomputes); the default
export name is `<working-folder name> <archive.tag><ext>`.

**Mapping cheat-sheet** (sidecar's job):
- hdvmerge `complete`/`fps`/`total_frames` → `complete`/`fps`/`tape.durationFrames`;
  `sources[]` (shift, tc/rec span, cc/tei/dec) → `captures[]`; `segments[]` → `segments[]`;
  `residuals[]` → `damage[] kind:"dirty"` (or `"missing"` when no `coverage`); `gaps[]` →
  `damage[] kind:"missing"`; `divergences[]` → `divergences[]`; `unused_sources[]` →
  `summary.unusedCaptures`.
- dvmerge `complete`/`fps` pass through; `spans[]` → `damage[]` (`kind` from span kind: mosaic→
  `dirty`, missing→`missing`; `cover` → `coverage`); `sources[]` → `captures[]`, including each
  source's `errorProfile` (DV only — dvrescue's per-capture concealment detail mined from its `-x`
  XML: true `concealedFrac`, `avgConcealedPct`, `evenSharePct` azimuth split, dominant `staMethod` +
  full `staHistogram`, and the audio side `audioConcealedFrac`), passed through verbatim.

## The UI it drives (design intent — now built)

The CLI engines can only print tables. tapeflow's whole point is to show the **spatial** picture a
GUI can. **Central insight: the tape is a 1-D timeline, each capture is a clip on it, and damage is
regions on it.** The signature view is a **tape-map**, rendered on **Canvas 2D** (a tape has
thousands of GOPs/frames — SVG/DOM would choke; Canvas pans/zooms smoothly).

- **Tape-map (the hero view).** A horizontal tape axis (dual ruler: tape TC + wall clock). Below it,
  one **lane per capture**, and on top a **best-of / result track**: green where some capture is
  clean, amber where only damaged copies exist (`dirty`), red/striped where it's `missing`. That
  result track *is* the re-capture map. Why it beats tables: you *see* why a spot can't be fixed (no
  lane covers it) vs. only-dirty (lanes cover it but all damaged), and across rounds you watch red
  turn green as new captures land. Two concrete build notes:
  - **Position lanes and damage by tape TC, not `axis`.** Convert `tcSpan` / `tcStart`
    (`"HH:MM:SS:FF"`) to seconds — TC is the natural shared coordinate, frame-accurate, and the
    engines provide it for every capture and damage spot. `axis` is an opaque, per-engine,
    not-yet-unified integer (see "Axis semantics"), useful only as a fallback. (Caveat: tape TC is
    *piecewise*-monotonic — a new recording after a gap can restart it; fine for one head-to-tail
    tape, but don't assume global monotonicity.)
  - **Colour lanes from `damage[]`, not `captures[].health`.** `health` is a legacy run-length
    field and is always `[]`; the lanes draw their coverage gaps and per-capture damage from the
    separate `damage[]` list — each spot's `coverage[]` names the captures that touch it, so a lane
    gets its damaged runs from the spots that list it. That list is complete and accurate; there is
    no per-GOP `health` track to wait on.
- **Re-capture sidebar**, synced to the map: each `damage[]` entry as a row — big copyable **tape
  TC** (the deck cue point), wall clock, duration, `kind`, and coverage ("0 copies — must
  re-capture" vs "2 dirty copies — may improve"). Click a row ⇄ highlight on the map.
- **Headline verdict**, loud and top: "✅ Complete — ready to export" or "⚠ 3 spots need
  re-capture (~4 s), 1 region missing entirely". Each round the user's real question is "am I done?"
- **Damage-frame thumbnails** — `window.api.thumbnail(dir, file, seconds)` returns a PNG data URL.
  The sidecar grabs the frame at `seconds` into *that capture's own playback*; **the renderer
  computes the offset**: `seconds = tcToSeconds(spot.tcStart) − tcToSeconds(capture.tcSpan[0])`,
  where `capture` is the one named in `spot.coverage[0]`. Show the damaged frame beside each
  re-capture row so the user can *see* the mosaic. A pure `missing` gap has no frame to grab.
- **Drag-drop ingest** — `window.api.ingest(dir, srcPaths)` copies dropped files into the working
  dir (Node fs in main) and returns the copied basenames; then call `analyze` again (only the new
  file gets indexed, thanks to the engine cache). The renderer supplies the dropped paths via
  Electron's `webUtils.getPathForFile(file)`.
- **Re-capture checklist state** (`.tapeflow/state.json`): each spot is outstanding / now-covered /
  accepted-unrecoverable. Re-analysis auto-marks covered ones; the user can accept a physically
  unreadable spot so it stops nagging.
- **Export** — `window.api.pickSave(name)` for a destination, then `window.api.build(dir, output)`
  → `BuildResult`. For HDV it carries a `verify` summary (AUX survived, CC/TEI integrity, decode) —
  surface it as a green check, or a warning when a knowingly-damaged merge is exported; DV has no
  separate self-check (`verify: null`). This is built as `BuildPanel.vue` — pick destination →
  build, then verify, **both with a determinate progress bar** (the verify is two full-file passes —
  an output re-scan then an ffmpeg decode — each reporting `(step/steps)`, so the formerly-silent
  self-check no longer reads as a hung spinner) → surface the verify summary. The verify's **`decodeErrorSpots`**
  (damage that only surfaces at final decode) are synthesised into the damage list as `kind: 'decode'`
  spots, so they get the same cards / map markers / accept-undo as analysis damage — and are persisted
  in `state.json` bound to the last export (the store re-merges them on each `analyze`, so they survive
  a re-analyse and clear only when the next export decodes clean).

The renderer realises this intent: dark-themed, internationalised (Auto / English / 简体中文), and
bound to the `tapeflow.analysis/1` contract. What remains is refinement on a working app, not a
first build.

**The renderer surface** (`window.api`, brokered by main) is typed in
[app/src/renderer/src/env.d.ts](app/src/renderer/src/env.d.ts) and `types.ts` — bind to those. It
is: `pickDir` · `pickSave` · `revealDir` · `capabilities` · `analyze(dir)` · `build(dir, output)` ·
`thumbnail(dir, file, seconds)` · `listCaptures(dir)` · `ingest(dir, srcPaths)` · `loadState(dir)` /
`saveState(dir, state)` · `onProgress(cb)`. Only `capabilities`/`analyze`/`build`/`thumbnail`
forward to the sidecar; the rest (dir/save pickers, reveal, capture listing, ingest copy, checklist
state) are handled in Electron main. All long jobs stream `progress` notifications through
`onProgress`. The renderer never touches the filesystem or the sidecar directly.

## Tech stack (decided)

| Layer | Choice |
| --- | --- |
| Front-end | **Vue 3 + TypeScript**, SFC + `<script setup>`, **Pinia** for state |
| Scaffold/build | **electron-vite** (Vue template) |
| Tape-map | **Canvas 2D**, a thin custom renderer (add `vue-konva` only if hit-testing gets painful) |
| Packaging | **electron-builder**, bundling the frozen sidecar as `extraResources` |
| Sidecar | Python **3.11+**, **hand-rolled JSON-RPC 2.0 / NDJSON over stdio** (no heavy dep) |
| Engine freeze | **PyInstaller onedir**, per-platform via a GitHub Actions matrix |
| Engine deps | **git submodules, pinned** (HTTPS, read-only) |
| Tooling | pnpm/npm for `app/`; **ruff** for the sidecar; prettier/eslint |

End users install **no Python and neither engine** — the release bundles Python + both engines
inside the app. They only need external **binaries** on PATH: **`dvrescue`** (required for DV) and
**`ffmpeg`** (recommended; HDV intra-frame damage detection + thumbnails). No PyPI publishing is
ever involved.

## Repo layout

```
tapeflow/
  engines/            git submodules, pinned (consumed via --json, never edited here)
    hdvmerge/  dvmerge/
  engine/             Python sidecar: JSON-RPC loop, format routing, normalisation
    src/tapeflow_engine/  rpc.py · methods.py · analyze.py · normalize.py · build.py · thumb.py · _bootstrap.py
    tests/                test_rpc.py · test_normalize.py · test_actions.py
  app/               Electron + Vue: main (Node) + renderer (Vue), the UI
    src/main/             index.ts (window + IPC) · sidecar.ts (JSON-RPC client)
    src/preload/          index.ts (contextBridge -> window.api)
    src/renderer/src/     App.vue · components/ (TapeMap, DamageSidebar, CaptureTable, BuildPanel, …)
                          stores/workflow.ts · utils/ · i18n/ · types.ts (the tapeflow.analysis/1 TS types)
  AGENTS.md  README.md
```

It is a polyglot monorepo, but needs no monorepo tool — `app/` has its own `package.json`,
`engine/` its own `pyproject.toml`, the engines manage themselves.

## Dev workflow

- **Clone recursively**: `git clone --recursive …` (or `git submodule update --init`).
- **Engines in dev**: the sidecar imports `hdvmerge` / `dvmerge`. For a dev environment, install the
  submodules editable into the sidecar's venv (`pip install -e engines/hdvmerge engines/dvmerge`);
  for release, PyInstaller freezes them in. Either way the engines are imported as libraries — the
  submodule is just *where the source lives, pinned*.
- **Bump an engine submodule pin** (after pushing the engine upstream): `git -C engines/<name> fetch
  && git -C engines/<name> checkout <commit>`, then `git add engines/<name>` and commit the new pin.
  This is the hdvmerge/dvmerge *pin*, not the product version below.
- **Engine work happens in the standalone repos** (`~/Projects/hdvmerge`, `~/Projects/dvmerge`),
  not inside the submodule copies; tapeflow only adopts pinned versions.
- **Cut a release** — one product version spans the app, this engine, and its CLI. Bump
  `app/package.json` *and* `engine/src/tapeflow_engine/__init__.py` (`__version__`) to the same
  `X.Y.Z` in one commit; `engine/pyproject.toml` reads `__version__`, so that file is the single
  engine version source — don't hard-code a version there. Then tag `vX.Y.Z` and push the tag (CI's
  `release` job builds every platform installer and drafts the GitHub release). The bundled
  hdvmerge/dvmerge keep their own upstream versions (pinned above); the wire contract is versioned
  separately as `tapeflow.analysis/N`. After the release assets exist, bump the Homebrew cask:
  `gh workflow run bump.yml -R xingrz/homebrew-tap -f project=tapeflow`.
- **Run the app in dev**: `cd app && npm install && npm run dev`. Electron main spawns the sidecar as
  `python3 -m tapeflow_engine` (cwd = repo root, `PYTHONPATH=engine/src`); the engines load from the
  pinned submodules via `_bootstrap`, so no pip install is needed. Needs `python3` on PATH; override
  the interpreter with `TAPEFLOW_PYTHON`. ffmpeg/dvrescue are optional/required per format as above.
- **Run the sidecar tests**: `cd engine && python -m unittest discover`.
- **Drive the sidecar directly** (no UI): pipe NDJSON requests to `PYTHONPATH=engine/src python -m
  tapeflow_engine`, e.g. `{"jsonrpc":"2.0","id":1,"method":"analyze","params":{"dir":"…"}}`.
- **Or use the thin CLI** (`tapeflow_engine.cli`): a one-shot front-end over the *same* `METHODS`
  for scripting/agents — `PYTHONPATH=engine/src python -m tapeflow_engine.cli analyze <dir>` (also
  `capabilities`, `build <dir> <out>`; `--compact` for one-line JSON). It adds no logic: `analyze`
  is the same normalisation the renderer gets, `build` is byte-for-byte the engines. stdout = the
  JSON result, stderr = progress. An installable skill wrapping it lives in `skills/tapeflow/`
  (`npx skills add xingrz/tapeflow`).

## When making changes (conventions / invariants)

- **Consume engines via `--json` only.** Never scrape Markdown, never read engine internals. If you
  need a field the contract doesn't expose, add it to the engine's `jsonout` (with a lock-step test)
  and bump the pin — don't work around it in tapeflow.
- **Normalise in the sidecar, nowhere else.** Format-specific knowledge stops at the sidecar;
  `tapeflow.analysis/1` is the only shape the renderer sees. Don't leak `dirty`/`missing` vocabulary
  into an engine, or `residual`/`mosaic` vocabulary into the renderer.
- **Sources are read-only.** tapeflow never modifies a user's capture files. Writes go to the merged
  output (on export), engine caches, and `.tapeflow/state.json`.
- **The working dir = one tape = one format.** Detect format by extension; if a dir mixes `.m2t` and
  `.dv`, that's a user error to surface, not something to merge.
- **First analysis is slow, re-analysis is fast.** Indexing (the expensive step) is cached per file;
  dropping in one new capture only indexes that file. Make this latency difference visible (progress
  for the slow first pass) so users don't think a fast re-run "didn't work".
- **Long jobs stream progress.** Never block the UI thread; analysis/build run in the sidecar and
  report via `progress` notifications.
- **The schema is the contract.** Changing `tapeflow.analysis/1` is a breaking change across the
  sidecar/renderer boundary — version it (`/2`) rather than silently reshaping it.

## Status

**Working end to end for both HDV and DV — backend and UI are both built.** The sidecar serves the
full method set over JSON-RPC — `capabilities` (engine imports + ffmpeg/dvrescue presence and
versions), `analyze` (HDV + DV, both verified on real tapes), `build` (export: HDV lossless
byte-concat + self-check, DV keeps dvrescue's merge), `thumbnail` (ffmpeg frame → PNG) — and
Electron main brokers them, alongside its own filesystem/state handlers, to a typed `window.api`.
The Vue renderer realises *The UI it drives*: the Canvas **tape-map** (dual TC/wall-clock ruler,
per-capture lanes, best-of result track), the synced **re-capture sidebar** with damage thumbnails
and accept-as-unrecoverable, **drag-drop ingest**, the persisted `.tapeflow/state.json` checklist,
a dark theme, and i18n (Auto / English / 简体中文). **Cross-platform packaging** — a
PyInstaller-frozen sidecar bundled by electron-builder on a GitHub Actions matrix — is wired. The
app builds and typechecks; the sidecar has unit tests + verified smokes.

**Known refinements:**
- **Cross-format axis unification** — `axis` is per-engine (GOP index vs tape frame) and only "good
  enough for drawing bars in order"; `tc`/`rec` stay the source of truth (see *Axis semantics*).
  Frame-accurate unification across formats is still open.
- **NTSC drop-frame labels** — `fps` now flows through from each engine (no PAL hard-coding), but
  `_tc_frames` uses non-drop arithmetic: exact for PAL, with small *label* drift on NTSC drop-frame
  timecodes. Layout is unaffected (axis is opaque); precise NTSC TC labelling is a refinement.
