---
name: tapeflow
description: >-
  Rescue a worn DV or HDV camcorder tape from several overlapping captures by merging the clean
  parts into one complete video. Use when given a folder of repeated tape captures (.dv or .m2t/.ts)
  and asked to check whether they add up to a complete recording, find which spots still need
  re-capturing, or export the merged file. Drives tapeflow's CLI over its hdvmerge/dvmerge engines,
  and can optionally drive the tapecap CLI to re-capture the damaged spots over FireWire itself.
metadata:
  internal: false
---

# tapeflow — merge overlapping DV/HDV tape captures

A worn videotape rarely reads cleanly in one pass: each capture is a slightly different, slightly
broken copy, with the clean frames scattered across different files. tapeflow lines the captures up,
tells you whether together they form a complete video, lists exactly which spots are still damaged,
and exports the merged result. It handles **both DV and HDV behind one interface** and routes by file
extension, so you point it at a folder and never choose an engine yourself.

This skill drives tapeflow's thin CLI, which is a one-shot front-end over the same code the desktop
app uses. It does **not** re-implement the merge: `build` is byte-for-byte the hdvmerge/dvmerge
engines (HDV preserves Sony's private AUX timecode that even `ffmpeg -c copy` strips; DV keeps
dvrescue's merge), and `analyze` is a faithful, normalised view of those engines' own output. The
result is identical to running the engines directly — you just get one unified schema and one verdict
instead of two engine-specific reports.

## Hand over everything — don't judge, don't curate

The whole method rests on one idea: you give tapeflow **every** capture of the tape — each pass,
re-capture and 补采 fragment, however broken — in one directory, and the engines pick the clean frames
per tape position across all of them (matched by *content*, not by filename or date). Two ways an
agent goes wrong here, both to avoid:

- **Don't pre-judge which material is good.** Never rank, skip, or discard a capture because it "looks
  corrupt", and don't try to single out the good frames or files yourself — a mostly-broken pass often
  holds the one clean copy of a frame no other pass caught. Deciding good-vs-bad per position *is* the
  engines' job, and it comes back to you as `analyze`'s verdict.
- **Don't feed a hand-picked subset.** Don't stage a curated selection with symlinks, copies, or a
  temp dir. Drop all captures into the real working dir and point `analyze`/`build` at that dir — they
  read every matching file in it and stay fast via the `.tapeflow/` cache. A partial set throws away
  the redundancy the merge depends on.

Your job is to run `analyze` and act on what it reports — not to curate its inputs.

## When to use

- You have a directory of **repeated captures of one tape** — several `.dv` files, or several
  `.m2t`/`.m2ts`/`.mts`/`.ts` files (one tape is one format; never mix).
- The task is: "are these captures complete?", "which parts still need re-capturing?", or "merge
  these into one file".

## Setup

### Finding the CLI

The skill carries the workflow, not the binary — so first locate a `tapeflow` CLI to run, trying
these in order and using the first that works. (Wherever the rest of this doc writes `tapeflow <cmd>`,
substitute whichever invocation you found.)

1. **On PATH** — try `tapeflow capabilities`. If it runs, the package is pip-installed; use
   `tapeflow <cmd>` directly.
2. **A tapeflow checkout** — if the working tree has `engine/src/tapeflow_engine/`, run `git submodule
   update --init` once (pulls the hdvmerge/dvmerge engines), then use
   `PYTHONPATH=engine/src python -m tapeflow_engine.cli <cmd>`. No install needed — a bootstrap shim
   puts the engine submodules on the import path.
3. **An installed TapeFlow app** — the desktop app bundles the CLI as a standalone `tapeflow-cli`
   binary, alongside its engine. Run it directly with the same subcommands:
   - **macOS** — `/Applications/TapeFlow.app/Contents/Resources/tapeflow-cli/tapeflow-cli`
   - **Windows** — `<install dir>\resources\tapeflow-cli\tapeflow-cli.exe` (default
     `%LOCALAPPDATA%\Programs\TapeFlow\…`)
   - **Linux** (AppImage) — extract once with `./TapeFlow*.AppImage --appimage-extract`, then
     `squashfs-root/resources/tapeflow-cli/tapeflow-cli`

   (An app built before this CLI shipped won't have `tapeflow-cli` — if the file isn't there, fall
   through.)
4. **None found** — don't guess or auto-install. Tell the user to install TapeFlow (`brew install
   --cask xingrz/tap/tapeflow`, or a build from the [Releases](https://github.com/xingrz/tapeflow/releases)
   page) or the `tapeflow` CLI, then retry.

Confirm with `capabilities` before going further — it reports engine imports and ffmpeg/dvrescue
presence and versions, and never fails on absence. External binaries on PATH: **dvrescue** is required
for DV; **ffmpeg** is recommended (it powers HDV damage detection).

## Commands

All three print one JSON document to **stdout**; progress streams to **stderr**. `--compact` (single-line
JSON) is a global flag — put it *before* the subcommand: `tapeflow --compact analyze <dir>`.

| Command | Purpose |
| --- | --- |
| `tapeflow capabilities` | Engine imports + ffmpeg/dvrescue presence and versions. |
| `tapeflow analyze <dir>` | Route the working dir by format and print the unified `tapeflow.analysis/1`. |
| `tapeflow build <dir> <output>` | Export the merged file (byte-for-byte the engine merge). |

Exit code is `0` on success, `2` on a user error (bad dir, mixed formats, missing dvrescue) with a
clean `error: …` line on stderr — not a traceback.

## Workflow

1. **Analyse.** `tapeflow analyze <dir>` → `tapeflow.analysis/1`. The first run indexes every capture
   (slow, GB files); re-runs are cached and fast.
2. **Read the verdict** from the JSON (see fields below). If `complete` is `true`, go to step 4.
   Otherwise report the re-capture list: for each `damage[]` entry give the operator the **`tcStart`**
   (the deck cue point), the `kind`, and the `coverage`.
3. **Re-capture and re-analyse.** New captures get dropped into the same dir; re-run `analyze`. Only
   the new file is indexed. The damage list shrinks each round. To drive the deck and fill the gaps
   automatically, see **Automatic re-capture with tapecap** below.
4. **Build — write it outside the captures dir.** When `buildable` is `true`,
   `tapeflow build <dir> <output>` writes the merged file. Put `<output>` in a **subdirectory** (e.g.
   `<dir>/out/merged.m2t`) or a sibling/parent — **never inside `<dir>` itself**: the merge is a
   `.m2t`/`.dv` file, so leaving it among the captures makes the next `analyze` ingest your own output
   as another "capture" and corrupt the result. (`analyze` lists only the top level and skips
   subdirectories, so a subdir is safe.) For HDV the result carries a `verify` summary (AUX/timecode
   survived, CC/TEI integrity, decode check); DV has `verify: null` (the merge and its metadata are
   dvrescue's).

You can export a knowingly-incomplete tape as long as `buildable` is `true` (HDV refuses only on
non-tape-adjacent seams); `complete` just tells you whether any damage remains.

## Reading `tapeflow.analysis/1`

The fields that drive decisions:

- **`complete`** (bool) — every tape position has a clean copy in the output. The "am I done?" answer.
- **`buildable`** (bool) — safe to export a merged file now.
- **`summary`** — `recaptureSpots` (improvable/needed damage entries), `missingFrames` (frames absent
  from *every* capture — lost unless re-captured), `unusedCaptures` (captures that couldn't be placed;
  their content is **not** in the output — flag this, it usually means a wrong/foreign file).
- **`damage[]`** — the actionable re-capture list. Per entry:
  - `kind`: `"dirty"` = covered but every copy is damaged (re-capturing *may* improve it) vs
    `"missing"` = no capture has it (lost unless re-captured).
  - `tcStart`/`tcEnd` (tape SMPTE timecode — the deck cue) and `recStart`/`recEnd` (camera wall-clock
    recording time); `durationFrames`.
  - `coverage[]`: captures that touch this spot (`[]` ⇒ nothing to improve on — purely missing);
    `copies`: how many; `severity`: a human label.
- **`captures[]`** — one per source file: `tag`, `file`, `tcSpan`, `recSpan`.
- **`tape`** — the reconstructed whole-tape span (`tcStart`/`tcEnd`, `recStart`/`recEnd`,
  `durationFrames`, `title`).

Always use `tc`/`rec` to describe *where* a spot is — they are frame-accurate and shared. The `axis`
field is an opaque per-engine integer for relative ordering only; never compute positions or
durations from it.

## Automatic re-capture with tapecap (optional)

`analyze` only *finds* the gaps — filling them means replaying the tape. If the user asks to
**re-capture the damaged spots automatically** (自动补采), you can drive the deck yourself, but only
when both of these are present:

- the **`tapecap`** CLI is installed and sees the deck, and
- the **tapecap skill** is installed in this agent.

If either is missing, **don't improvise a capture** — report the damage list (Workflow step 2) and
let the operator capture manually. When both are present, **follow the tapecap skill for every
capture, seek and transport command**; the steps below are only the orchestration tapeflow adds on
top, with `analyze`'s `damage[]`/`tape` timecodes as the targets. Each pass writes a *new* file into
`<dir>`; re-run `analyze` after every pass (only the new file is indexed, so it's fast).

1. **Capture wider than the gap.** A `damage[]` entry's `tcStart`/`tcEnd` are the *damaged* bounds,
   not the capture bounds — aim the window a margin outside them on both sides so the new fragment
   comfortably overlaps the neighbouring good material the merge needs to stitch it in.
2. **Batch neighbours; seek sparingly.** Sort `damage[]` by `tcStart` and roll through it in one
   continuous pass, capturing straight across adjacent spots. Only fast-wind to the next spot when the
   clean gap between them exceeds **~2 minutes** — every stop-start and re-seek wears the transport, so
   rolling through a minute or two of good tape is cheaper than stopping and re-positioning.
3. **Re-analyse, retry a spot up to 3×.** After a capture, re-run `analyze`. If a spot you just
   covered is still in `damage[]`, rewind and re-capture just that spot — capped at **3 attempts**. A
   spot that hasn't improved in 3 tries won't this round; mark it skipped and move on so you don't
   grind the transport on one place.
4. **Global cleanup pass (up to twice).** Once you've been down the whole tape, go back to the spots
   skipped after 3 tries and try them again, same **3-strikes-then-skip** rule per spot. Repeat this
   whole-tape cleanup at most **twice**.
5. **Stress-release, then a final attempt.** If two cleanup passes still leave spots failing, run the
   tape end to end once — full rewind to `tape.tcStart`, then fast-forward to `tape.tcEnd` — to relieve
   its tension, then give each still-failing spot **2 more tries**.
6. **Stop and ask.** If spots still fail after that, **stop** — don't keep cycling the deck on a spot
   the tape can't give up. Report what's left (each spot's `tc`, `kind` and `coverage`/`copies`) and
   ask the user whether to `build` the merged file as it stands (`buildable` is usually still `true`)
   or leave it for a manual attempt.

Sources stay read-only throughout: each re-capture is an additive archival fragment, never an
overwrite — it only gives the merge more material to pick the clean frames from.

## Guardrails

- **Give it everything; don't curate.** Hand over all captures and let `analyze` judge — never
  pre-screen files by eye or feed a hand-picked subset (see *Hand over everything* above). This is the
  rule agents break most.
- **One tape = one format.** A dir mixing `.m2t` and `.dv` is a user error the CLI rejects — surface
  it, don't try to merge across formats.
- **Keep the build output out of the captures dir.** The merge is a `.m2t`/`.dv` file; left in `<dir>`
  it becomes a phantom capture on the next `analyze`. Write it to a subdir or a sibling/parent
  (Workflow step 4).
- **Sources are read-only.** tapeflow never modifies the captures; writes go only to the merged
  output (outside `<dir>`) and the engine caches under `<dir>/.tapeflow/`.
- **Don't reach past the CLI.** The `tapeflow.analysis/1` JSON is the contract; don't scrape the
  engines' own reports or internals.
