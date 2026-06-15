export default {
  app: {
    subtitle: 'DV / HDV 合并',
    chooseDir: '选择目录',
    reAnalyse: '重新分析',
    exportMerged: '导出合并文件',
    noDir: '未选择工作目录',
    resizeCaptures: '调整采集面板大小',
    resizeRecapture: '调整补采面板大小',
    showCaptures: '展开采集面板',
    showRecapture: '展开补采面板',
    settings: '设置',
    revealDir: '在文件管理器中打开'
  },
  settings: {
    title: '设置',
    language: '语言',
    tools: '外部工具',
    toolsHint: 'PATH 中找到的可选程序。ffmpeg 用于缩略图与 HDV 解码校验；dvrescue 是 DV 合并的必需项。',
    toolPresent: '已安装',
    toolMissing: '未找到',
    close: '关闭'
  },
  lang: {
    label: '语言',
    auto: '自动（跟随系统）',
    en: 'English',
    'zh-CN': '简体中文'
  },
  verdict: {
    analysing: '正在分析工作区',
    selected: '已选择工作区',
    choosePrompt: '选择一个工作目录来分析磁带。',
    complete: '完整——每个磁带位置都有干净拷贝。',
    spots: '{n} 处需要补采',
    missingEntirely: '{dur} 完全缺失',
    accepted: '{count} 处已接受为不可恢复',
    unplaced: '{count} 个未排入的采集',
    queued: '已排队 {count} 个采集文件'
  },
  metrics: {
    outstanding: '待处理',
    dirty: '损坏',
    missing: '缺失',
    captures: '采集'
  },
  empty: {
    title: '选择一个磁带工作目录',
    body: '分析同一盘磁带的多个重叠采集，然后把新的补采拖到这里复制进工作区并重新分析。'
  },
  drop: {
    ingest: '拖入采集文件以导入',
    chooseFirst: '请先选择一个工作目录',
    willCopy: '文件将被复制进来，随后重新运行分析。',
    needWorkspace: 'TapeFlow 需要一个目标磁带工作区。'
  },
  build: {
    completed: '导出完成',
    completedWarnings: '导出完成（含警告）',
    dismiss: '关闭',
    building: '正在构建合并文件…',
    verifying: '正在校验合并文件…'
  },
  verify: {
    dvDone: 'DV 导出由 dvrescue 完成',
    auxPresent: 'AUX 存在',
    auxMissing: 'AUX 缺失',
    ccClean: 'CC/TEI 正常',
    ccWarning: 'CC/TEI 警告',
    decodeErrors: '{count} 个解码错误'
  },
  captures: {
    title: '采集',
    allLinked: '全部已排入',
    unplaced: '{count} 个未排入',
    linkedTip: '引擎排入的每个采集都已呈现在上方的磁带图中。',
    unplacedTip: '{count} 个采集无法排入磁带，未包含在合并输出中。',
    lanesSegments: '{lanes} 条泳道 · {segments} 个输出片段',
    lanesDvMerge: '{lanes} 条泳道 · DV 逐帧合并',
    dvMerge: 'DV 逐帧合并',
    filesInWorkspace: '工作区中有 {count} 个文件',
    collapse: '折叠采集面板',
    show: '采集',
    file: '文件',
    tapeTc: '磁带时间码',
    recordingTime: '录制时间',
    format: '格式',
    size: '大小',
    index: '索引',
    quality: {
      persistent: '每帧约 {pct} 损坏',
      intermittent: '{pct} 的帧有损坏',
      headEven: '偏偶场',
      headOdd: '偏奇场',
      tip: '隐藏方式 {method} · {concealed}/{seen} 帧含损坏 · 偶场占 {even}'
    }
  },
  status: {
    pending: '等待中',
    indexing: '索引中',
    indexed: '已索引',
    cached: '已缓存'
  },
  tasks: {
    title: '正在准备工作区',
    hint: '正在复制并索引采集文件。',
    dvLabel: 'dvrescue 合并',
    remaining: '剩 {eta}',
    stage: {
      pending: '排队中',
      copying: '复制中',
      indexing: '索引中',
      merging: '合并中',
      done: '完成'
    }
  },
  recapture: {
    title: '补采',
    show: '补采',
    regions: '分析得到 {count} 处当前区域',
    noRegions: '当前无损坏区域',
    collapse: '折叠补采面板',
    copy: '复制磁带时间码',
    copied: '已复制',
    noTc: '无时间码',
    accept: '接受',
    undo: '撤销',
    markOutstanding: '标记为待处理',
    acceptUnrecoverable: '接受为不可恢复',
    damage: '损坏',
    nothing: '没有需要补采的内容。',
    copiesRequired: '0 个拷贝——需要补采',
    dirtyCopies: '{n} 个损坏拷贝',
    close: '关闭',
    loadingFrame: '正在加载画面…',
    holdToCompare: '按住查看原图',
    showingOriginal: '原始画面 · 松手恢复标记'
  },
  kind: {
    dirty: '损坏',
    missing: '缺失'
  },
  thumb: {
    enlarge: '点击放大',
    highlighted: '错误隐藏区域以黄色高亮 · 点击放大',
    noFrame: '此处无可用画面',
    loading: '加载中'
  },
  map: {
    title: '磁带图',
    axisFallback: '部分时间码缺失，布局回退到引擎坐标轴。',
    result: '结果',
    tapeTcClock: '磁带时间码 / 时钟',
    tapeCoordinate: '磁带坐标',
    zoomIn: '放大',
    zoomOut: '缩小',
    fit: '适应整盘磁带'
  },
  progress: {
    indexing: '正在索引 {file}',
    usingCached: '使用缓存索引：{file}',
    indexed: '已索引 {file}',
    building: '正在构建合并文件',
    verifying: '正在校验合并文件',
    merging: '正在合并',
    runningTool: '正在运行 {tool}',
    starting: '开始分析',
    exporting: '正在导出合并文件',
    copying: '正在复制 {count} 个拖入的采集',
    copied: '已复制 {files}',
    working: '处理中'
  },
  errors: {
    chooseDirFirst: '拖入采集前请先选择一个工作目录。',
    noPaths: '拖入的文件没有可用的本地路径。'
  }
}
