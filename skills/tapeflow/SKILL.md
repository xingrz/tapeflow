---
name: tapeflow
description: >-
  Rescue a worn DV or HDV camcorder tape from several overlapping captures by merging the clean
  parts into one complete video. Use when given a folder of repeated tape captures (.dv or .m2t/.ts)
  and asked to check whether they add up to a complete recording, find which spots still need
  re-capturing, partition an explicitly multi-event or mixed DV/HDV tape into event working sets
  (including exact byte cuts at HDV timecode resets), or export the merged file. Also audits an
  already-exported master file on its own (read-only) — its completeness "TF tag" and any duplicate
  frames — to tag or re-check masters, e.g. on a NAS. Drives tapeflow's CLI over its hdvmerge/dvmerge
  engines, and can optionally drive the tapecap CLI to re-capture the damaged spots over FireWire
  itself. Also trigger on Chinese phrasings: 检查磁带/带子采集是否完整、合并多次采集、
  多事件磁带分段/按日期切割、DV/HDV 混合磁带、补采（自动补采）损坏段、导出合并母带、
  给母带打 TF 标签.
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

## Give each event every usable capture

A working directory is one intended event and one format (or the whole tape
when the user wants one event). After event partitioning, put **every** pass,
re-capture and 补采 fragment assigned to that event into its real working
directory, however damaged. Never curate by apparent quality: a bad-looking
file may hold the only clean copy of a frame, and choosing per-position winners
is the engine's job.

Keep an HDV capture that crosses a backwards/reset timecode boundary in staging
until its event fragments have been derived. Ordinary roughly 3-second event
overlap is intentionally approximate and needs no post-cut.

## Setup

### Finding the CLI

The skill carries the workflow, not the binary. Try these in order and use the
first successful invocation wherever this document says `tapeflow`:

1. `tapeflow capabilities` (an installed CLI on PATH).
2. From a checkout, run `git submodule update --init` once, then use
   `PYTHONPATH=engine/src python -m tapeflow_engine.cli`.
3. Use the `tapeflow-cli` bundled under an installed TapeFlow app's resources,
   or `python3 tapeflow-<version>.pyz` for a portable release (Python ≥ 3.7).
4. If none exists, do not guess or auto-install. Ask the user to install
   TapeFlow/its CLI, then retry.

Confirm with `capabilities` before going further — it reports engine imports and ffmpeg/dvrescue
presence and versions, and never fails on absence. External binaries on PATH: **dvrescue** is required
for DV; **ffmpeg** is recommended (it powers HDV damage detection).

## Commands

Each command prints one JSON document to **stdout**; progress streams to **stderr**. `--compact`
(single-line JSON) is a global flag — put it *before* the subcommand: `tapeflow --compact analyze <dir>`.

| Command | Purpose |
| --- | --- |
| `tapeflow capabilities` | Engine imports + ffmpeg/dvrescue presence and versions. |
| `tapeflow analyze <dir>` | Route the working dir by format and print the unified `tapeflow.analysis/1`. |
| `tapeflow build <dir> <output>` | Export the merged file (byte-for-byte the engine merge). |
| `tapeflow verify <file>` | Audit one already-built master from the file alone (read-only): `tapeflow.verify/1`. |

Exit code is `0` on success, `2` on a user error (bad dir, mixed formats, missing dvrescue) with a
clean `error: …` line on stderr — not a traceback.

## Preparing an explicitly multi-event tape

Use event handling only when the user identifies multiple events, asks for
separate masters, or asks you to discover them. Otherwise treat the reel as one
event. For discovery, follow tapecap's sparse-probe workflow; never take a full
pass only to map the contents.

Choose one of these mutually exclusive cases:

- **Ordinary same-format boundary:** capture each event directly, using a
  sustained recording-date change as the approximate boundary. Start about 3
  seconds early and let capture run about 3 seconds into the next event; no
  exact positioning or post-cut is required. Adjacent event files therefore
  share about 6 seconds.
- **HDV timecode goes backwards or resets:** final fragments must meet without
  overlap. Because the deck cannot land on the reset frame, capture across it
  into staging—whether this is a full source or a small re-capture—then run
  `tapeflow analyze <staging-dir>` to create
  `.tapeflow/hdvmerge/<capture>.idx.jsonl`; find the first GOP of the later
  event and use its `off` as the shared half-open cut (`earlier[..off)`,
  `later[off..]`). Copy bytes verbatim, never remux, and verify the output sizes
  account for the selected source range exactly. If a gap hid the reset, capture
  one new window spanning both events and distribute the two derived sides to
  their event dirs. Preserve the original.
- **DV timecode drops out, resets, or oscillates with zero:** ignore it. LP and
  imperfect DV can do this repeatedly and DV playback tolerates it; partition
  only on sustained recording-date changes with the ordinary direct-capture
  overlap.
- **DV/HDV format change:** one invocation cannot capture both. Use tapecap's
  forced-format boundary procedure to create separate `.dv` and `.m2t`
  captures, then place them in separate event directories.

Treat a brief different-date insert (typically under a minute) between two
substantial events as part of the nearer/contextually related event unless the
user says otherwise. Never omit it.

## Workflow

1. **Analyse.** `tapeflow analyze <dir>` → `tapeflow.analysis/1`. The first run indexes every capture
   (slow, GB files); re-runs are cached and fast. **After the first capture pass, always stop here and
   read this report before deciding how to capture again.** A large tapecap continuity/drop count is
   not a reason to start another full-reel pass: only this report shows which errors survived and
   which spans actually need more material.
2. **Read the verdict** from the JSON (see fields below). If `complete` is `true`, go to step 4.
   Otherwise report the re-capture list: for each `damage[]` entry give the operator the **`tcStart`**
   (the deck cue point), the `kind`, and the `coverage`.
3. **Re-capture and re-analyse.** Add an ordinary new capture to the same dir
   and re-run `analyze`; only that file is indexed. For an HDV reset boundary,
   stage and split the cross-boundary capture first, then add each derived side
   to its event dir and analyse every affected dir. Prefer report-directed
   targets. Make another full pass only when the report shows targeted capture
   is impractical or the user explicitly requests one. For automation, see
   below.
4. **Build — name it after the tape, write it outside the captures dir.** When `buildable` is `true`,
   `tapeflow build <dir> <output>` writes the merged file. Two rules for `<output>`:
   - **Name** it after the working directory itself with the completeness tag appended, matching what
     the TapeFlow app produces: **`<folder name> <archive.tag><ext>`** — use the working dir's own
     basename (not a generic "merged"), one space, then `archive.tag` verbatim, then the format's
     extension: **`.m2t` for HDV, `.dv` for DV** (the `format` field says which). E.g. a dir
     `…/2010.10.29 校运会_CAM-C` whose analysis gives `archive.tag = "(TF99%-3)"` and `format = "dv"`
     exports `2010.10.29 校运会_CAM-C (TF99%-3).dv`. The `(TF…)` is greppable and easy to strip later.
   - **Place** it in a **subdirectory** (e.g. `<dir>/out/`) or a sibling/parent — **never inside
     `<dir>` itself**: the merge is a `.m2t`/`.dv` file, so leaving it among the captures makes the next
     `analyze` ingest your own output as another "capture" and corrupt the result. (`analyze` lists
     only the top level and skips subdirectories, so a subdir is safe.)

   For HDV the result carries a `verify` summary (AUX/timecode survived, CC/TEI integrity, decode
   check); DV has `verify: null` (the merge and its metadata are dvrescue's). **After an HDV build,
   inspect `verify.decode_error_spots`** — `residual`/`stitch` entries are extra re-capture targets that
   only surface at decode (see *What counts as a re-capture target* below): re-capture each spot's `tc`,
   re-export, and confirm it cleared. A clean tape can pass `analyze` yet still reveal one here.

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
- **`archive`** — the completeness **"TF tag"** for the merged master: the figure TapeFlow shows in
  its title bar and stamps onto the export name. `archive.tag` is the ready-made marker, e.g.
  `"(TF99%-3)"` or `"(TF100%)"` — read **`TF<percentage>%-<spots>`**, where the percentage is the
  share of tape frames with **no** residual damage after the merge (floored, so only a genuine 100.0%
  reads as `100`; 99.9% shows `99`), and `-N` is the residual spot count (`dirty + missing`, dropped
  when zero). `archive.tier` colours it: `green` only at a true 100, `yellow` ≥ 90, `red` below. Use
  `archive.tag` **verbatim** when naming the output (see Build) — don't recompute it yourself.

Always use `tc`/`rec` to describe *where* a spot is — they are frame-accurate and shared. The `axis`
field is an opaque per-engine integer for relative ordering only; never compute positions or
durations from it.

**What counts as a re-capture target.** Two signals say a tape still needs another pass — treat them the
same way, both driven by a spot's **`tc`**:

- **`damage[]`** from `analyze` (counted by `summary.recaptureSpots`) — the damage known *before* export
  (`dirty` = covered but every copy damaged; `missing` = no copy at all).
- the built file's **`verify.decode_error_spots[]`** — damage that surfaces only when the finished master
  is **decoded** (HDV; empty for DV). Each `{frame, tc, rec, kind, count}`. `kind` is `residual`
  (intra-frame damage no capture had clean), `stitch` (a fresh-start island edge — a real gap or a
  divergence cut), `transport` (a TS break), or `unexplained` (a decode error on content nothing in the
  plan explains). **`residual`/`stitch` ⇒ re-capture that `tc`** (a clean copy, or a pass that resolves
  the divergence), re-export, and confirm the spot cleared — the exact same loop as `damage[]`, just
  driven by the decode check. **`unexplained` ⇒ flag it** (it may be real damage no pass can fix, or a
  benign seam artifact — one re-capture at its `tc` tells which: if it clears it was recoverable, if not
  leave it). **Always check this after a build:** independent of the tag, a `complete`/100% master can
  still carry one (e.g. a divergence cut).

**Some reported figures are NOT re-capture targets** — don't report them as remaining damage or let them
block a build:

- **`divergences[]`** — spots where two otherwise-*clean* copies of one frame differ byte-for-byte (the
  tape read that frame differently on different passes; e.g. a deck re-locking at a record-pause seam).
  The merge keeps one (the version the most copies agree on, else the one in the longest clean run) and
  emits it once; a divergence never enters `damage[]`, lowers `complete`, or blocks a build, so it is
  not a re-capture target. (Optional: to *confirm* which version is the true frame, capture another
  pass — once two passes agree, that consensus version wins.)
- the built file's **`verify.seam_discontinuities`** — a count of timestamp (DTS) steps a demuxer sees.
  A byte-exact merge never rewrites PTS/DTS, but overlapping HDV captures carry the **tape's own**
  (identical) timestamps, so a cross-capture join is *usually continuous* — the count is **not** the
  number of splices (a tape with 28 joins and 154 record-pauses showed just 6). The few that remain are
  non-monotonic points in the tape's *own recorded* timestamps, preserved verbatim — not merge-induced,
  and **not removable** by re-capture or a different merge (only a whole-stream PTS/DTS rewrite would
  erase them, which the byte-exact merge deliberately never does). Cosmetic (some players' seeking),
  never fails the build, **not** damage.
- the built file's **`verify.duplicate_frames`** — should be empty. If a master (typically one built by
  an *older* engine) reports any, it holds the same tape moment twice (a divergent copy stitched in
  redundantly). That is a *merge* artifact, not a tape problem: **re-build with the current engine** (the
  merge now de-duplicates) — re-capturing won't change it.

## Auditing an existing master with `verify`

`tapeflow verify <master>` audits ONE already-built master **from the file alone** — no working dir and
no source captures — for both formats (HDV `.m2t`/`.ts` or DV `.dv`). It is **read-only w.r.t. the
master** (nothing is written beside it, so it is safe on a NAS / read-only volume): HDV reads the file
in memory; **DV** needs `dvrescue` and re-runs its merge with all temps in **system scratch** (a
full-size throwaway copy — guard is automatic; point `TMPDIR` at a volume with ≈ the master's size
free). Use it to tag an untagged master, or to find masters that should be re-built.

**Only reach for `verify` when the source captures aren't in front of you.** In the normal `analyze` →
`build` flow, the *build's own* `verify` summary (the `BuildResult.verify` block — CC/TEI, decode,
`decode_error_spots`) is the authoritative, plan-aware post-build check; act on **that**. Do **not** run
`verify <file>` to "double-check" or "be safe about" a master you just built with its captures present:
being plan-less it is a *conservative lower bound* that reads **worse** than the build's own check (more
spots, lower tag — never higher), so it will only mislead you into thinking a good build is damaged, and
it re-decodes the whole file for nothing. `verify` is for a master seen **alone** — a NAS audit, an
untagged file, a master whose working dir is gone.

It prints `tapeflow.verify/1`; act on these fields, **in this order**:

- **`sound`** (bool) — the stream parsed as a real master (HDV: valid MPEG-TS with Sony AUX timecode
  intact at both ends; DV: dvrescue read it). `false` ⇒ the file is broken or not a real master: stop,
  flag it, ignore the rest.
- **`duplicateFrames[]`** (HDV only; always empty for DV) — tape moments emitted more than once
  (`{tc, rec, copies}`). Non-empty ⇒ the master carries redundant frames (built by an older engine).
  **Fix by re-building** with the current engine — *not* by re-capturing (a duplicate is a merge
  artifact, not a tape problem).
- **`decodeErrorSpots[]`** (HDV only; empty for DV) — WHERE the master still decodes badly, each
  `{frame, tc, rec, kind, count}` (`kind`: `residual` / `stitch` / `transport` / `unexplained`). Same
  field a build's `verify.decode_error_spots` carries — but standalone `verify` is *conservative*: with
  no build plan to name a divergence cut, such a glitch reads as `unexplained` here (a build would call
  it `stitch`). `residual`/`stitch` ⇒ try another capture at that `tc`; `unexplained` ⇒ investigate.
- **`archive.tag`** + **`complete`** — the self-assessed completeness. Stamp `archive.tag` onto the
  filename to label an untagged master (the same `<name> <tag>.m2t` rule as Build). `complete: false`
  (or a sub-100% tag) ⇒ genuinely missing footage, which `verify` alone can't fix — that needs the
  **source captures** re-merged (`analyze`/`build`), and maybe more re-capture.
- **`summary`** / **`damage[]`** — where and how much is incomplete (for the human report).

Keep two things straight: **a duplicate ⇒ re-build; an incomplete tag ⇒ go back to the sources** — never
re-capture over a duplicate. And `verify` and `analyze` answer **different questions**: `analyze` is the
*best a master could be* from the captures (a recoverable frame — clean in some copy — counts clean);
`verify` is *what this one file already is*. For **HDV** that's a conservative **lower bound** (≤
`analyze`): a true 100% master reads 100%, but *past a real damaged spot* it can read a touch low — a
lone file has no clean twin to discredit ffmpeg's cascaded decode errors against, so `analyze` the
source dir for the best achievable tag. For **DV** there is no such gap: verify re-runs dvrescue's own
merge, so its tag matches `analyze` exactly.

## Automatic re-capture with tapecap (optional)

Drive the deck only when the tapecap CLI sees it **and** the tapecap skill is
available. Otherwise report the targets for manual capture. Follow that skill
for every transport command; the rules here only orchestrate tapeflow results.

A target is one `damage[]` spot, one `verify.decode_error_spots[]` item, or
nearby spots batched under rule 4. Use this loop:

1. **Work one target at a time.** Capture it, ingest it, then immediately
   re-analyse before choosing the next target; the list is live state. For a
   target at an HDV reset boundary, stage the wide capture, split it, ingest
   both sides as applicable, and analyse every affected event directory.
2. **Capture wider than the reported damage.** `tcStart`/`tcEnd` describe the
   defect, not the capture bounds. Include good material on both sides. If the
   window crosses an HDV reset boundary, apply the exact-split rule above rather
   than trying to steer around it.
3. **Cover physical edges twice.** Analysis cannot detect content earlier than
   every capture's start or later than every capture's end. Capture a head target
   from the physical beginning and a tail target through the physical end, with
   at least two independent passes for each affected edge.
4. **Batch only close neighbours.** Combine spots only when the known clean gap
   is at most 2 minutes. If it is 2:01 or cannot be computed confidently, keep
   separate targets.
5. **Use tapeflow as the repair oracle.** Ignore tapecap transport telemetry when
   judging success. Retry a still-overlapping target up to 3 times, then skip it
   for this round. For a decode-error target, rebuild and inspect
   `decode_error_spots` instead of relying on `analyze`; leave an `unexplained`
   spot after one failed re-capture.
6. **Run at most two cleanup rounds** over skipped targets, retaining the
   3-attempt cap. If failures remain, run the tape once across its full physical
   length to release tension, then give each remaining target 2 final tries.
7. **Stop and ask** if anything remains. Report each spot's `tc`, `kind`, and
   coverage/copies; ask whether to build the current result or leave it for a
   manual attempt.

Sources stay read-only throughout: each re-capture is an additive archival fragment, never an
overwrite — it only gives the merge more material to pick the clean frames from.

## Guardrails

- **One working dir = one intended event = one format** (or the whole tape when deliberately treated
  as one event). A dir mixing `.m2t` and `.dv` is a user error the CLI rejects — surface it, don't try
  to merge across formats.
- **Keep the build output out of the captures dir.** The merge is a `.m2t`/`.dv` file; left in `<dir>`
  it becomes a phantom capture on the next `analyze`. Write it to a subdir or a sibling/parent
  (Workflow step 4).
- **Sources are read-only.** tapeflow never modifies the captures; writes go only to the merged
  output (outside `<dir>`) and the engine caches under `<dir>/.tapeflow/`.
- **Don't reach past the CLI.** The `tapeflow.analysis/1` JSON is the contract; don't scrape the
  engines' own reports or internals.
