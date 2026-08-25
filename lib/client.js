window.__ModuleLoader__.load({
	id: "@local/dsh-collab-score",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region lib/client/locales.js
		/** `scoreCollab` namespace dictionaries. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "scoreCollab";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"entry.label": "乐谱",
			"entry.open": "打开乐谱面板",
			"entry.close": "关闭乐谱面板",
			"panel.title": "乐谱协作",
			"panel.placeholder": "点击「打开引擎」在独立标签页使用乐谱编辑器；agent 可调用 score_create / score_open / score_edit 操作本会话乐谱",
			"panel.session": "会话：{id}",
			"panel.preset": "模式：{preset}",
			"panel.health.loading": "连接中…",
			"panel.health.ok": "服务正常",
			"panel.health.fail": "服务不可达",
			"panel.workdir.empty": "尚无工作目录",
			"panel.workdir": "工作目录：{workdir}",
			"panel.manifest.ready": "已加载乐谱 {scoreId}，回合 {round}",
			"panel.manifest.empty": "工作目录存在但尚无 manifest",
			"panel.openEngine": "打开引擎",
			"panel.openEngine.hint": "在新标签页打开本会话的乐谱编辑引擎（独立实例，互不干扰）"
		};
		/** English dictionary, key-identical to the Chinese source of truth. */
		const en = {
			"entry.label": "Score",
			"entry.open": "Open score panel",
			"entry.close": "Close score panel",
			"panel.title": "Score collaboration",
			"panel.placeholder": "Open the score editor in its own tab via \"Open engine\"; the agent can drive this session's score with score_create / score_open / score_edit",
			"panel.session": "session: {id}",
			"panel.preset": "mode: {preset}",
			"panel.health.loading": "connecting…",
			"panel.health.ok": "service healthy",
			"panel.health.fail": "service unreachable",
			"panel.workdir.empty": "no workdir yet",
			"panel.workdir": "workdir: {workdir}",
			"panel.manifest.ready": "loaded score {scoreId}, round {round}",
			"panel.manifest.empty": "workdir exists but no manifest yet",
			"panel.openEngine": "Open engine",
			"panel.openEngine.hint": "Open this session's score engine in a new tab (isolated instance)"
		};
		//#endregion
		//#region lib/client/ScorePanelToggle.js
		/** Modal-style overlay that hosts the session-scoped engine viewer iframe. */
		const overlayStyle = {
			position: "fixed",
			top: 56,
			right: 16,
			zIndex: 100,
			width: "min(1200px, 92vw)",
			height: "min(820px, 88vh)",
			padding: 12,
			borderRadius: 8,
			display: "flex",
			flexDirection: "column",
			gap: 8,
			background: "var(--dsw-alias-bg-overlay)",
			color: "var(--dsw-alias-label-primary)",
			font: "13px/1.6 var(--dsw-font-family)",
			boxShadow: "0 8px 32px rgba(0, 0, 0, 0.25)"
		};
		const headerStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			cursor: "move",
			userSelect: "none"
		};
		const closeButtonStyle = {
			marginLeft: "auto",
			color: "var(--dsw-alias-label-secondary)",
			background: "none",
			border: "none",
			cursor: "pointer",
			font: "inherit"
		};
		const frameStyle = {
			flex: 1,
			width: "100%",
			border: 0,
			borderRadius: 4,
			background: "#fff"
		};
		/**
		* Session-header entry point for the score panel. Renders nothing unless the
		* session runs the score-collab preset — the mode gate (R8) at UI level, the
		* mirror of composition-level tool gating. Opening the panel shows the
		* session-scoped MuseScore engine viewer inline (one iframe per session, its
		* own workdir and engine instance — sessions never share an editor).
		* @param props - runtime slot currency plus the namespace translator.
		* @returns the entry and its engine overlay, or null outside score-collab mode.
		*/
		function ScorePanelToggle({ sessionId, useSessions, t }) {
			const preset = useSessions((state) => state.byId[sessionId]?.agentPreset);
			const [open, setOpen] = (0, react.useState)(false);
			const [drag, setDrag] = (0, react.useState)(null);
			const overlayRef = (0, react.useRef)(null);
			if (preset !== "score-collab") return null;
			const startDrag = (event) => {
				event.preventDefault();
				const rect = overlayRef.current?.getBoundingClientRect();
				const baseLeft = rect?.left ?? 0;
				const baseTop = rect?.top ?? 0;
				const startX = event.clientX;
				const startY = event.clientY;
				const move = (ev) => {
					setDrag({
						x: baseLeft + ev.clientX - startX,
						y: baseTop + ev.clientY - startY
					});
				};
				const up = () => {
					window.removeEventListener("mousemove", move);
					window.removeEventListener("mouseup", up);
				};
				window.addEventListener("mousemove", move);
				window.addEventListener("mouseup", up);
			};
			const overlayPosition = drag === null ? {
				right: 16,
				top: 56
			} : {
				left: drag.x,
				top: drag.y,
				right: "auto"
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 6
				},
				children: [(0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-pressed": open,
					"aria-haspopup": "dialog",
					title: open ? t("entry.close") : t("entry.open"),
					onClick: () => setOpen((next) => !next),
					style: {
						color: "var(--dsw-alias-label-secondary)",
						background: "none",
						border: "none",
						cursor: "pointer"
					},
					children: t("entry.label")
				}), open ? (0, react_jsx_runtime.jsxs)("div", {
					ref: overlayRef,
					style: {
						...overlayStyle,
						...overlayPosition
					},
					role: "dialog",
					"aria-label": t("panel.title"),
					children: [(0, react_jsx_runtime.jsxs)("div", {
						style: headerStyle,
						onMouseDown: startDrag,
						children: [
							(0, react_jsx_runtime.jsx)("strong", { children: t("panel.title") }),
							(0, react_jsx_runtime.jsx)("span", {
								style: { opacity: .75 },
								children: t("panel.session", { id: sessionId })
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								title: t("entry.close"),
								onClick: () => setOpen(false),
								style: closeButtonStyle,
								children: "✕"
							})
						]
					}), (0, react_jsx_runtime.jsx)("iframe", {
						src: `/score-collab/engine/viewer.html?session=${encodeURIComponent(sessionId)}`,
						style: frameStyle,
						title: "MuseScore 引擎",
						allow: "autoplay; clipboard-write"
					})]
				}) : null]
			});
		}
		//#endregion
		//#region lib/client/index.js
		/** Required services for locale registration and header-slot contribution. */
		const inject = ["slots", "locale"];
		/**
		* Client plugin body: register the dictionaries and the header action.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "score-collab: dictionaries");
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "score-collab-entry",
				order: 30,
				locale: NS
			}, ScorePanelToggle));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map