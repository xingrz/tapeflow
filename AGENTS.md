# Working context for agents

`tapeflow` is a **cross-platform desktop GUI** (Windows / Linux / macOS) for merging overlapping
captures of a worn **DV or HDV videotape** into one complete file — **both formats behind one
interface**. It is the graphical front-end to two existing command-line engines; it does not
reinvent the merge and it does not capture from tape.

If you are here to work on the **UI**, read *What it is*, *The unified data model*, and *The UI it
drives* — that last section is the design intent to build toward; the current UI is deliberately
plain ("ugly-first") and is yours to make good. Bind the UI to the `tapeflow.analysis/1` contract,
not to anything engine-specific.

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

**Mapping cheat-sheet** (sidecar's job):
- hdvmerge `complete`/`fps`/`total_frames` → `complete`/`fps`/`tape.durationFrames`;
  `sources[]` (shift, tc/rec span, cc/tei/dec) → `captures[]`; `segments[]` → `segments[]`;
  `residuals[]` → `damage[] kind:"dirty"` (or `"missing"` when no `coverage`); `gaps[]` →
  `damage[] kind:"missing"`; `divergences[]` → `divergences[]`; `unused_sources[]` →
  `summary.unusedCaptures`.
- dvmerge `complete`/`fps` pass through; `spans[]` → `damage[]` (`kind` from span kind: mosaic→
  `dirty`, missing→`missing`; `cover` → `coverage`); `sources[]` → `captures[]`.

## The UI it drives (design intent — build toward this)

The CLI engines can only print tables. tapeflow's whole point is to show the **spatial** picture a
GUI can. **Central insight: the tape is a 1-D timeline, each capture is a clip on it, and damage is
regions on it.** The signature view is a **tape-map**, rendered on **Canvas 2D** (a tape has
thousands of GOPs/frames — SVG/DOM would choke; Canvas pans/zooms smoothly).

- **Tape-map (the hero view).** A horizontal tape axis (dual ruler: tape TC + wall clock). Below it,
  one **lane per capture** positioned by `captures[].axis`, coloured clean/damaged from `health`.
  On top, a **best-of / result track**: green where some capture is clean, amber where only damaged
  copies exist (dirty), red/striped where it's `missing`. That result track *is* the re-capture map.
  Why it beats tables: you *see* why a spot can't be fixed (no lane covers it) vs. only-dirty (lanes
  cover it but all damaged), and across rounds you watch red turn green as new captures land.
- **Re-capture sidebar**, synced to the map: each `damage[]` entry as a row — big copyable **tape
  TC** (the deck cue point), wall clock, duration, `kind`, and coverage ("0 copies — must
  re-capture" vs "2 dirty copies — may improve"). Click a row ⇄ highlight on the map.
- **Headline verdict**, loud and top: "✅ Complete — ready to export" or "⚠ 3 spots need
  re-capture (~4 s), 1 region missing entirely". Each round the user's real question is "am I done?"
- **Damage-frame thumbnails** (sidecar `thumbnail` via ffmpeg): show the damaged frame (and the
  last-good frame) beside each row, so the user can *see* the mosaic and recognise it while scrubbing
  the physical tape. For a pure `missing` gap there is no frame — bracket it with the surrounding
  good frames.
- **Drag-drop ingest**: drop a capture on the window → main copies it into the working dir (with
  progress) → auto re-analyse (only the new file gets indexed, thanks to the engine cache).
- **Re-capture checklist state** (`.tapeflow/state.json`): each spot is outstanding / now-covered /
  accepted-unrecoverable. Re-analysis auto-marks covered ones; the user can accept a physically
  unreadable spot so it stops nagging.
- **Export**: when complete/accepted, build the merged file (sidecar `build`) and surface the
  engine's self-check (AUX timecode survived, CC/TEI integrity, decode clean) as a reassuring green
  check.

Ugly-first is fine and expected. Prioritise correct data binding and the tape-map's information
content; visual polish is the follow-up.

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
    src/tapeflow_engine/  rpc.py · methods.py · analyze.py · normalize.py · _bootstrap.py
    tests/                test_rpc.py · test_normalize.py
  app/               Electron + Vue: main (Node) + renderer (Vue), the UI
    src/main/             index.ts (window + IPC) · sidecar.ts (JSON-RPC client)
    src/preload/          index.ts (contextBridge -> window.api)
    src/renderer/src/     App.vue · types.ts (the tapeflow.analysis/1 TS types)
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
- **Bump an engine version** (after pushing the engine upstream): `git -C engines/<name> fetch &&
  git -C engines/<name> checkout <commit>`, then `git add engines/<name>` and commit the new pin.
- **Engine work happens in the standalone repos** (`~/Projects/hdvmerge`, `~/Projects/dvmerge`),
  not inside the submodule copies; tapeflow only adopts pinned versions.
- **Run the app in dev**: `cd app && npm install && npm run dev`. Electron main spawns the sidecar as
  `python3 -m tapeflow_engine` (cwd = repo root, `PYTHONPATH=engine/src`); the engines load from the
  pinned submodules via `_bootstrap`, so no pip install is needed. Needs `python3` on PATH; override
  the interpreter with `TAPEFLOW_PYTHON`. ffmpeg/dvrescue are optional/required per format as above.
- **Run the sidecar tests**: `cd engine && python -m unittest discover`.
- **Drive the sidecar directly** (no UI): pipe NDJSON requests to `PYTHONPATH=engine/src python -m
  tapeflow_engine`, e.g. `{"jsonrpc":"2.0","id":1,"method":"analyze","params":{"dir":"…"}}`.

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

**Vertical slice works (HDV).** Engine `--json` contracts are pinned; the sidecar discovers a
working dir, runs hdvmerge, and normalises to `tapeflow.analysis/1` over JSON-RPC (capabilities +
analyze, progress streamed); the Vue app picks a dir, calls analyze, and renders the completeness
verdict + re-capture list + captures (plain, ugly-first). End-to-end verified on synthetic captures;
the app builds and typechecks (launching the window needs `npm run dev` on a real desktop).

**Not yet wired** (build on the slice, in roughly this order):
- the **Canvas tape-map** (the hero view) and per-capture `health` runs — the latter needs hdvmerge's
  `--json` to expose per-GOP damage positions (extend `jsonout` + lock-step test, bump the pin);
- **DV** path (`dvmerge` + `dvrescue`) in `analyze` — currently returns a clear "not wired" error;
- `build` (export the merged file + surface the engine self-check) and `thumbnail` (ffmpeg) — both
  stubbed with NotImplemented;
- **drag-drop ingest** (copy into the working dir + auto re-analyse) and the
  `.tapeflow/state.json` re-capture checklist (outstanding / covered / accepted).
