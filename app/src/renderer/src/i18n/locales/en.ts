export default {
  app: {
    subtitle: 'DV / HDV merge',
    chooseDir: 'Choose directory',
    reAnalyse: 'Re-analyse',
    exportMerged: 'Export merged',
    noDir: 'No working directory',
    resizeCaptures: 'Resize captures panel',
    resizeRecapture: 'Resize re-capture panel',
    showCaptures: 'Show captures',
    showRecapture: 'Show re-capture',
    settings: 'Settings',
    revealDir: 'Reveal in file manager'
  },
  settings: {
    title: 'Settings',
    language: 'Language',
    tools: 'External tools',
    toolsHint: 'Optional binaries found on PATH. ffmpeg powers thumbnails and HDV decode checks; dvrescue is required for DV.',
    toolPresent: 'installed',
    toolMissing: 'not found',
    close: 'Close'
  },
  lang: {
    label: 'Language',
    auto: 'Auto (follow system)',
    en: 'English',
    'zh-CN': '简体中文'
  },
  verdict: {
    analysing: 'Analysing workspace',
    selected: 'Workspace selected',
    choosePrompt: 'Choose a working directory to analyse a tape.',
    complete: 'Complete — every tape position has a clean copy.',
    spots: '{n} spot needs re-capture | {n} spots need re-capture',
    missingEntirely: '{dur} missing entirely',
    accepted: '{count} accepted as unrecoverable',
    unplaced: '{count} unplaced captures',
    queued: '{count} capture files queued'
  },
  metrics: {
    outstanding: 'outstanding',
    dirty: 'dirty',
    missing: 'missing',
    captures: 'captures'
  },
  empty: {
    title: 'Select a tape working directory',
    body: 'Analyse the overlapping captures for one physical tape, then drop new re-captures here to copy them into the workspace and re-run analysis.'
  },
  drop: {
    ingest: 'Drop captures to ingest',
    chooseFirst: 'Choose a working directory first',
    willCopy: 'Files will be copied in, then analysis runs again.',
    needWorkspace: 'TapeFlow needs a target tape workspace.'
  },
  build: {
    completed: 'Export completed',
    completedWarnings: 'Export completed with warnings',
    dismiss: 'Dismiss',
    building: 'Building merged file…',
    verifying: 'Verifying merged file…'
  },
  verify: {
    dvDone: 'DV export completed by dvrescue',
    auxPresent: 'AUX present',
    auxMissing: 'AUX missing',
    ccClean: 'CC/TEI clean',
    ccWarning: 'CC/TEI warning',
    decodeErrors: '{count} decode errors'
  },
  captures: {
    title: 'Captures',
    allLinked: 'All linked',
    unplaced: '{count} unplaced',
    linkedTip: 'Every capture the engine placed is represented on the tape map above.',
    unplacedTip: '{count} capture(s) could not be placed onto the tape and are not in the merged output.',
    lanesSegments: '{lanes} lanes · {segments} output segments',
    lanesDvMerge: '{lanes} lanes · DV frame merge',
    dvMerge: 'DV frame merge',
    filesInWorkspace: '{count} files in workspace',
    collapse: 'Collapse captures',
    show: 'Captures',
    file: 'File',
    tapeTc: 'Tape TC',
    recordingTime: 'Recording time',
    quality: {
      persistent: 'damaged ~{pct}/frame',
      intermittent: '{pct} of frames damaged',
      headEven: 'even-field biased',
      headOdd: 'odd-field biased',
      tip: 'concealed ({method}) · {concealed}/{seen} frames · even-field share {even}'
    }
  },
  status: {
    pending: 'pending',
    indexing: 'indexing',
    indexed: 'indexed',
    cached: 'cached'
  },
  tasks: {
    title: 'Preparing workspace',
    hint: 'Copying and indexing the captures.',
    dvLabel: 'dvrescue merge',
    remaining: '{eta} left',
    stage: {
      pending: 'queued',
      copying: 'copying',
      indexing: 'indexing',
      merging: 'merging',
      done: 'done'
    }
  },
  recapture: {
    title: 'Re-capture',
    show: 'Re-capture',
    regions: '{count} current regions from analysis',
    noRegions: 'No current damage regions',
    collapse: 'Collapse re-capture',
    copy: 'Copy tape TC',
    copied: 'Copied',
    noTc: 'No TC',
    accept: 'Accept',
    undo: 'Undo',
    markOutstanding: 'Mark as outstanding',
    acceptUnrecoverable: 'Accept as unrecoverable',
    damage: 'Damage',
    nothing: 'Nothing to re-capture.',
    copiesRequired: '0 copies — re-capture required',
    dirtyCopies: '{n} dirty copy | {n} dirty copies',
    close: 'Close',
    loadingFrame: 'Loading frame…',
    holdToCompare: 'Hold to see the original',
    showingOriginal: 'Original · release to restore marks'
  },
  kind: {
    dirty: 'dirty',
    missing: 'missing'
  },
  thumb: {
    enlarge: 'Click to enlarge',
    highlighted: 'Error-concealment regions are highlighted in yellow · click to enlarge',
    noFrame: 'No frame for this spot',
    loading: 'Loading'
  },
  map: {
    title: 'Tape map',
    axisFallback: 'Some TC labels are missing, so layout falls back to engine axis.',
    result: 'Result',
    tapeTcClock: 'Tape TC / clock',
    tapeCoordinate: 'Tape coordinate',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit whole tape'
  },
  progress: {
    indexing: 'Indexing {file}',
    usingCached: 'Using cached index for {file}',
    indexed: 'Indexed {file}',
    building: 'Building merged file',
    verifying: 'Verifying merged file',
    merging: 'Merging',
    runningTool: 'Running {tool}',
    starting: 'Starting analysis',
    exporting: 'Exporting merged file',
    copying: 'Copying {count} dropped captures',
    copied: 'Copied {files}',
    working: 'Working'
  },
  errors: {
    chooseDirFirst: 'Choose a working directory before dropping captures.',
    noPaths: 'No local file paths were available for the dropped files.'
  }
}
