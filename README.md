# tapeflow

A cross-platform (Windows / Linux / macOS) GUI for the **DV and HDV tape-capture merge
workflow** — both formats in one interface. You point it at a working directory of overlapping
captures of a worn tape; it analyses them, tells you whether they merge into a complete video,
and lists the damaged spots that still need re-capturing — each cued by the tape's SMPTE
timecode (to find it on the deck) and the camera's wall-clock recording time. Re-capture those
spots on your old deck, drop the new files in, re-analyse; the list shrinks. When complete,
export the merged file.

tapeflow does **not** capture (modern hardware can't) and does **not** reinvent the merge. It
drives two existing engines and unifies their output behind one UI.

## How it's put together

```
tapeflow/
  engines/
    hdvmerge/   ← git submodule (pinned)   HDV / Sony MPEG-TS (.m2t): the merge engine itself
    dvmerge/    ← git submodule (pinned)   DV (.dv): a layer over the `dvrescue` CLI
  engine/       (planned)  Python sidecar: imports the two engines, normalises their `--json`
                           output into one model, speaks JSON-RPC over stdio
  app/          (planned)  Electron front-end: the tape-map UI, drag-drop ingest, export
```

The engines are pulled in as **git submodules pinned to a specific commit**, so a checkout is
reproducible and an engine's later evolution can never silently reach tapeflow's build until the
pin is deliberately bumped. tapeflow consumes each engine through its structured `--json`
contract (`hdvmerge.analysis/1`, `dvmerge.analysis/1`) — never by scraping the human Markdown.
The engines remain independent, standalone projects:

- hdvmerge — https://github.com/xingrz/hdvmerge
- dvmerge — https://github.com/xingrz/dvmerge

## Working with the repo

Clone **recursively** so the engine submodules come with it — no need to replicate any local
directory layout:

```sh
git clone --recursive https://github.com/xingrz/tapeflow.git
# already cloned without --recursive?
git submodule update --init
```

Bump an engine to a newer pinned version (after it has been pushed upstream):

```sh
git -C engines/hdvmerge fetch && git -C engines/hdvmerge checkout <commit>
git add engines/hdvmerge && git commit -m "Bump hdvmerge pin"
```

> The submodule URLs are HTTPS read-only — tapeflow only ever *consumes* the engines, so anyone
> (and CI) can clone recursively without SSH keys. Engine development and pushing happen in the
> standalone engine repos, not here.

## Requirements (end users)

The packaged app bundles Python and both engines, so end users install neither. They only need
these external binaries on PATH:

- **dvrescue** (MediaArea/MIPoPS) — required for DV.
- **ffmpeg** — recommended; powers HDV intra-frame damage detection and damage-frame thumbnails.

## Status

Early. A working **vertical slice** is in place for **both HDV and DV**: pick a working directory →
the Python sidecar analyses it (HDV via hdvmerge, DV via dvmerge→dvrescue) → the app shows the
completeness verdict, the re-capture list, and the captures (deliberately plain for now). Run it in
dev with `cd app && npm install && npm run dev` (needs `python3` on PATH, plus `dvrescue` for DV;
engines load from the pinned submodules automatically).

Next: the Canvas tape-map UI, export of the merged file, damage-frame thumbnails, and drag-drop
ingest. See [AGENTS.md](AGENTS.md) for the architecture and the `tapeflow.analysis/1` contract.
