/** `scoreCollab` namespace dictionaries. */
/** Dictionary namespace owned by this plugin. */
export const NS = 'scoreCollab';
/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
    'entry.label': '乐谱',
    'entry.open': '打开乐谱面板',
    'entry.close': '关闭乐谱面板',
    'panel.title': '乐谱协作',
    'panel.placeholder': '点击「打开引擎」在独立标签页使用乐谱编辑器；agent 可调用 score_create / score_open / score_edit 操作本会话乐谱',
    'panel.session': '会话：{id}',
    'panel.preset': '模式：{preset}',
    'panel.health.loading': '连接中…',
    'panel.health.ok': '服务正常',
    'panel.health.fail': '服务不可达',
    'panel.workdir.empty': '尚无工作目录',
    'panel.workdir': '工作目录：{workdir}',
    'panel.manifest.ready': '已加载乐谱 {scoreId}，回合 {round}',
    'panel.manifest.empty': '工作目录存在但尚无 manifest',
    'panel.openEngine': '打开引擎',
    'panel.openEngine.hint': '在新标签页打开本会话的乐谱编辑引擎（独立实例，互不干扰）',
};
/** English dictionary, key-identical to the Chinese source of truth. */
export const en = {
    'entry.label': 'Score',
    'entry.open': 'Open score panel',
    'entry.close': 'Close score panel',
    'panel.title': 'Score collaboration',
    'panel.placeholder': 'Open the score editor in its own tab via "Open engine"; the agent can drive this session\'s score with score_create / score_open / score_edit',
    'panel.session': 'session: {id}',
    'panel.preset': 'mode: {preset}',
    'panel.health.loading': 'connecting…',
    'panel.health.ok': 'service healthy',
    'panel.health.fail': 'service unreachable',
    'panel.workdir.empty': 'no workdir yet',
    'panel.workdir': 'workdir: {workdir}',
    'panel.manifest.ready': 'loaded score {scoreId}, round {round}',
    'panel.manifest.empty': 'workdir exists but no manifest yet',
    'panel.openEngine': 'Open engine',
    'panel.openEngine.hint': 'Open this session\'s score engine in a new tab (isolated instance)',
};
//# sourceMappingURL=locales.js.map