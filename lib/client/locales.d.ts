/** `scoreCollab` namespace dictionaries. */
/** Dictionary namespace owned by this plugin. */
export declare const NS = "scoreCollab";
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    readonly 'entry.label': "乐谱";
    readonly 'entry.open': "打开乐谱面板";
    readonly 'entry.close': "关闭乐谱面板";
    readonly 'panel.title': "乐谱协作";
    readonly 'panel.placeholder': "点击「打开引擎」在独立标签页使用乐谱编辑器；agent 可调用 score_create / score_open / score_edit 操作本会话乐谱";
    readonly 'panel.session': "会话：{id}";
    readonly 'panel.preset': "模式：{preset}";
    readonly 'panel.health.loading': "连接中…";
    readonly 'panel.health.ok': "服务正常";
    readonly 'panel.health.fail': "服务不可达";
    readonly 'panel.workdir.empty': "尚无工作目录";
    readonly 'panel.workdir': "工作目录：{workdir}";
    readonly 'panel.manifest.ready': "已加载乐谱 {scoreId}，回合 {round}";
    readonly 'panel.manifest.empty': "工作目录存在但尚无 manifest";
    readonly 'panel.openEngine': "打开引擎";
    readonly 'panel.openEngine.hint': "在新标签页打开本会话的乐谱编辑引擎（独立实例，互不干扰）";
};
/** English dictionary, key-identical to the Chinese source of truth. */
export declare const en: Record<ScoreKey, string>;
/** Key domain of the `scoreCollab` namespace (zh is the source of truth). */
export type ScoreKey = keyof typeof zh;
