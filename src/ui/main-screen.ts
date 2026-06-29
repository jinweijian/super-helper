export function renderApp(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>super helper</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f4f6f8; color: #1f2933; }
    .app { min-height: 100vh; display: grid; grid-template-rows: 56px 1fr; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 20px; background: #fff; border-bottom: 1px solid #d9e2ec; }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; }
    .brand-button { height: auto; border: 0; background: transparent; padding: 0; display: flex; align-items: center; gap: 10px; font: inherit; font-weight: 700; color: inherit; }
    .mark { width: 28px; height: 28px; border-radius: 7px; background: #2f80ed; color: white; display: grid; place-items: center; }
    .pill { border: 1px solid #cbd6e2; background: #f8fafc; color: #536475; border-radius: 999px; padding: 5px 9px; font-size: 12px; }
    .pill.warn { border-color: #f3c15f; background: #fff8e6; color: #7a4b00; }
    .pill.error { border-color: #ffb3b3; background: #fff1f1; color: #9b1c1c; }
    .workspace-shell { min-height: 0; height: calc(100vh - 56px); display: grid; grid-template-columns: 264px minmax(0, 1fr); }
    .sessions-sidebar { min-height: 0; overflow: hidden; border-right: 1px solid #d9e2ec; background: #ffffff; display: grid; grid-template-rows: auto minmax(0, 1fr); }
    .sessions-head { padding: 14px; border-bottom: 1px solid #edf1f5; display: grid; gap: 10px; }
    .sessions-head h2 { margin: 0; font-size: 14px; }
    .session-list { min-height: 0; max-height: 100%; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; align-content: initial; gap: 6px; padding: 10px; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
    .session-item { flex: 0 0 auto; min-height: 58px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px; align-items: stretch; border: 1px solid #cbd6e2; border-radius: 8px; background: #fff; overflow: visible; }
    .session-item.active { border-color: #2f80ed; background: #eef6ff; }
    .session-open { height: auto; min-height: 56px; text-align: left; display: grid; gap: 4px; padding: 9px 10px; border: 0; background: transparent; border-radius: 0; min-width: 0; }
    .session-more { width: 32px; height: 32px; align-self: center; padding: 0; }
    .session-menu-wrap { position: relative; display: grid; align-items: center; padding-right: 6px; }
    .session-menu { display: none; position: absolute; right: 6px; top: 42px; z-index: 5; width: 104px; padding: 4px; border: 1px solid #cbd6e2; border-radius: 8px; background: #fff; box-shadow: 0 8px 22px rgba(15,23,42,.14); }
    .session-menu.open { display: grid; gap: 3px; }
    .session-menu button { width: 100%; justify-content: flex-start; text-align: left; border: 0; background: transparent; padding: 0 8px; }
    .session-menu button:hover { background: #eef6ff; }
    .session-title { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-meta { font-size: 11px; color: #697b8c; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    main { height: 100%; max-width: 920px; width: 100%; margin: 0 auto; padding: 18px 18px 0; display: grid; grid-template-rows: auto 1fr auto; gap: 12px; overflow: hidden; }
    .case { background: white; border: 1px solid #d9e2ec; border-radius: 10px; padding: 13px 14px; display: flex; justify-content: space-between; gap: 12px; }
    h1 { margin: 0 0 4px; font-size: 18px; }
    .muted { color: #697b8c; font-size: 13px; line-height: 1.5; }
    button { height: 34px; border: 1px solid #cbd6e2; border-radius: 7px; background: white; padding: 0 12px; color: #263647; font-weight: 600; cursor: pointer; }
    button.primary { border-color: #2f80ed; background: #2f80ed; color: white; }
    .chat { min-height: 0; min-width: 0; overflow: auto; display: grid; align-content: start; gap: 12px; padding: 4px 0 8px; }
    .msg { max-width: 82%; min-width: 0; border: 1px solid #d9e2ec; border-radius: 11px; padding: 11px 13px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; background: white; box-shadow: 0 1px 2px rgba(15,23,42,.03); }
    .msg.user { margin-left: auto; background: #eef6ff; border-color: #cfe4ff; }
    .msg.helper { margin-right: auto; }
    .msg.error { border-color: #ffc9c9; background: #fff5f5; color: #9b1c1c; }
    .msg.helper h1, .msg.helper h2, .msg.helper h3 { margin: 4px 0 8px; line-height: 1.35; }
    .msg.helper h1 { font-size: 18px; }
    .msg.helper h2 { font-size: 16px; }
    .msg.helper h3 { font-size: 14px; }
    .msg.helper ul, .msg.helper ol { margin: 6px 0; padding-left: 20px; }
    .msg.helper code { background: #eef2f6; border-radius: 5px; padding: 1px 5px; font-size: 12px; overflow-wrap: anywhere; }
    .msg.helper pre { max-width: 100%; margin: 8px 0 0; padding: 10px; border: 1px solid #cbd6e2; border-radius: 7px; background: #0f172a; color: #e5edf7; font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; overflow: auto; max-height: 420px; word-break: break-word; }
    .msg.helper strong { color: #1b6fd8; font-weight: 850; }
    .msg.helper mark { background: #fff2b8; color: #4d3800; padding: 0 3px; border-radius: 3px; }
    .answer-body { display: grid; gap: 8px; }
    .answer-body br + br { display: none; }
    .answer-emphasis { color: #183b6d; font-weight: 850; }
    .answer-section-title { color: #182230; font-weight: 850; }
    .answer-evidence { margin-top: 12px; border-top: 1px solid #d9e2ec; padding-top: 10px; }
    .answer-evidence summary { cursor: pointer; color: #1b6fd8; font-size: 12px; font-weight: 850; list-style: none; }
    .answer-evidence summary::-webkit-details-marker { display: none; }
    .answer-evidence-body { display: grid; gap: 10px; padding-top: 10px; }
    .answer-evidence-group { display: grid; gap: 6px; }
    .answer-evidence-group strong { color: #182230; }
    .answer-evidence-row { display: grid; gap: 3px; padding: 8px; border: 1px solid #d9e2ec; border-radius: 8px; background: #f8fafc; font-size: 12px; line-height: 1.45; }
    .answer-evidence-row span { color: #697b8c; overflow-wrap: anywhere; }
    .msg.thinking { display: flex; align-items: flex-start; gap: 10px; color: #3d4f60; }
    .thinking-indicator { display: inline-flex; align-items: center; gap: 4px; min-width: 34px; }
    .thinking-indicator span { width: 7px; height: 7px; border-radius: 999px; background: #2f80ed; animation: pulse-dot 1.1s infinite ease-in-out; }
    .thinking-indicator span:nth-child(2) { animation-delay: .15s; }
    .thinking-indicator span:nth-child(3) { animation-delay: .3s; }
    @keyframes pulse-dot { 0%, 80%, 100% { opacity: .35; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
    .activity-trace { display: grid; gap: 4px; min-width: 0; }
    .activity-step { font-size: 12px; color: #536475; }
    .activity-step strong { color: #263647; }
    .composer { position: sticky; bottom: 0; background: white; border: 1px solid #d9e2ec; border-radius: 12px 12px 0 0; padding: 12px; display: grid; gap: 10px; box-shadow: 0 -8px 24px rgba(15,23,42,.06); }
    textarea { width: 100%; min-height: 78px; max-height: 180px; border: 0; outline: 0; resize: vertical; font: inherit; line-height: 1.5; overflow-wrap: anywhere; }
    .tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
    .composer-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
    .composer-meta .pill { display: inline-flex; align-items: center; min-height: 30px; padding: 0 10px; }
    .composer-actions { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
    .persona-control { display: inline-flex; align-items: center; gap: 8px; width: max-content; max-width: 100%; height: 38px; border: 1px solid #cbd6e2; border-radius: 8px; background: #fff; padding: 0 8px 0 10px; flex: 0 0 auto; }
    .persona-label { color: #536475; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .persona-control select { width: 92px; height: 32px; border: 0; background: transparent; padding: 0 20px 0 0; font-weight: 700; color: #263647; }
    #sendButton { margin-left: auto; }
    .context-meter { margin-top: 8px; min-width: min(420px, 100%); display: grid; gap: 5px; }
    .context-meter-track { height: 7px; border-radius: 999px; background: #e5ebf2; overflow: hidden; }
    .context-meter-bar { height: 100%; width: 0%; background: #2f80ed; transition: width .25s ease, background .25s ease; }
    .context-meter.warn .context-meter-bar { background: #d99118; }
    .context-meter.error .context-meter-bar { background: #d64545; }
    .context-meter-text { font-size: 11px; color: #697b8c; }
    .drawer { position: fixed; inset: 0; display: none; }
    .drawer.open { display: block; }
    .shade { position: absolute; inset: 0; background: rgba(15,23,42,.35); }
    .drawer-panel { position: absolute; right: 0; top: 0; bottom: 0; width: min(560px, 92vw); background: white; display: grid; grid-template-rows: 56px 1fr; }
    .drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid #edf1f5; padding: 0 14px; }
    .drawer-actions { display: flex; align-items: center; gap: 8px; }
    .logs { overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .log { border: 1px solid #d9e2ec; border-radius: 8px; padding: 10px; background: #fbfcfe; font-size: 12px; white-space: pre-wrap; }
    .log-block { flex: 0 0 auto; border: 1px solid #d9e2ec; border-radius: 8px; background: #fbfcfe; overflow: hidden; }
    /* runtime severity classes: log-block ok, log-block warn, log-block error */
    .log-block summary { cursor: pointer; list-style: none; display: grid; gap: 5px; padding: 10px; }
    .log-block summary::-webkit-details-marker { display: none; }
    .log-block.ok { border-color: #a9d8b2; background: #f4fbf5; }
    .log-block.warn { border-color: #f0ce7b; background: #fff9e8; }
    .log-block.error { border-color: #ffb7b7; background: #fff4f4; }
    .log-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 700; }
    .log-label { font-size: 11px; border-radius: 999px; padding: 2px 7px; background: rgba(255,255,255,.75); border: 1px solid rgba(83,100,117,.18); color: #536475; }
    .log-meta { color: #697b8c; font-size: 11px; }
    .log-detail { border-top: 1px solid rgba(83,100,117,.15); padding: 10px; white-space: pre-wrap; overflow: auto; max-height: 360px; }
    .log-command { margin: 10px; padding: 10px; border: 1px solid #cbd6e2; border-radius: 7px; background: #0f172a; color: #e5edf7; font: 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; overflow: auto; max-height: 220px; }
    .settings-form { overflow: auto; padding: 14px; display: grid; gap: 12px; }
    label { display: grid; gap: 6px; font-size: 13px; font-weight: 700; color: #3d4f60; }
    input, select { height: 38px; border: 1px solid #cbd6e2; border-radius: 7px; padding: 0 10px; font: inherit; background: white; color: #1f2933; }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .status { min-height: 42px; border: 1px solid #d9e2ec; border-radius: 8px; padding: 10px; background: #fbfcfe; font-size: 12px; white-space: pre-wrap; color: #3d4f60; }
    .agent-list { display: grid; gap: 8px; }
    .agent-card { border: 1px solid #d9e2ec; border-radius: 8px; padding: 10px; background: #fbfcfe; display: grid; gap: 5px; font-size: 12px; }
    .agent-card strong { font-size: 13px; }
    @media (max-width: 820px) {
      .workspace-shell { grid-template-columns: 1fr; grid-template-rows: 150px minmax(0, 1fr); }
      .sessions-sidebar { min-height: 0; border-right: 0; border-bottom: 1px solid #d9e2ec; }
      .sessions-head { grid-template-columns: 1fr auto; align-items: center; padding: 10px 12px; }
      .session-list { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(210px, 260px); overflow-x: auto; overflow-y: hidden; padding: 8px 10px; }
      .session-item { min-height: 54px; }
    }
    @media (max-width: 700px) { main { padding: 12px 12px 0; } .case { display: grid; } .msg { max-width: 100%; } }
    @media (max-width: 520px) { .composer-actions { align-items: stretch; } .persona-control { flex: 1 1 auto; } #sendButton { align-self: flex-end; } }

    /* design refresh 2026-06 */
    :root {
      --bg: #f4f7fb;
      --surface: #fdfefe;
      --surface-soft: #f8fafd;
      --surface-strong: #eef3fa;
      --text: #182230;
      --muted: #667085;
      --soft: #8a96a8;
      --border: #d9e1ec;
      --border-strong: #bfccdb;
      --accent: #2d6cdf;
      --accent-hover: #2159be;
      --accent-soft: #edf4ff;
      --accent-line: #b9d4ff;
      --warn: #b96f10;
      --warn-soft: #fff7e8;
      --warn-line: #efca82;
      --error: #b42318;
      --error-soft: #fff4f3;
      --error-line: #f5b5af;
      --ok: #247a43;
      --ok-soft: #f1fbf5;
      --ok-line: #a7d8b8;
      --shadow-sm: 0 1px 2px rgba(16, 24, 40, .05);
      --shadow-md: 0 12px 32px rgba(16, 24, 40, .08);
      --shadow-drawer: -24px 0 60px rgba(16, 24, 40, .18);
      --radius: 8px;
      --font-sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
      --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101620;
        --surface: #171e2a;
        --surface-soft: #1d2634;
        --surface-strong: #253247;
        --text: #e8edf5;
        --muted: #a3adbc;
        --soft: #7f8ba0;
        --border: #313c4f;
        --border-strong: #48576f;
        --accent: #78adff;
        --accent-hover: #9ac2ff;
        --accent-soft: #172b4c;
        --accent-line: #365d96;
        --warn: #f4b24c;
        --warn-soft: #322512;
        --warn-line: #795d24;
        --error: #ff8d84;
        --error-soft: #351a1b;
        --error-line: #70413e;
        --ok: #6cc58b;
        --ok-soft: #13291d;
        --ok-line: #315f43;
        --shadow-sm: 0 1px 2px rgba(0, 0, 0, .28);
        --shadow-md: 0 16px 36px rgba(0, 0, 0, .28);
        --shadow-drawer: -24px 0 60px rgba(0, 0, 0, .44);
      }
    }
    html, body { min-height: 100%; }
    body {
      font-family: var(--font-sans);
      font-size: 14px;
      background: linear-gradient(180deg, var(--surface-soft) 0%, var(--bg) 48%, var(--surface-strong) 100%);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    .app { min-height: 100dvh; grid-template-rows: 58px minmax(0, 1fr); }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      gap: 16px;
      padding: 0 18px 0 14px;
      background: rgba(253, 254, 255, .88);
      border-bottom-color: var(--border);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
    @media (prefers-color-scheme: dark) { header { background: rgba(17, 23, 34, .88); } }
    .brand, .brand-button { min-width: 0; font-weight: 750; letter-spacing: 0; }
    .brand-button { height: 38px; padding: 0 8px 0 0; border-radius: var(--radius); cursor: pointer; }
    .brand-button:hover { background: var(--surface-soft); }
    .mark {
      width: 30px;
      height: 30px;
      border-radius: var(--radius);
      background: linear-gradient(135deg, var(--accent), #214a96);
      color: #fdfefe;
      font-weight: 800;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .28), 0 6px 16px rgba(45, 108, 223, .18);
    }
    .pill {
      min-width: 0;
      max-width: min(54vw, 560px);
      display: inline-flex;
      align-items: center;
      border-color: var(--border);
      background: var(--surface-soft);
      color: var(--muted);
      font-weight: 650;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pill.warn { border-color: var(--warn-line); background: var(--warn-soft); color: var(--warn); }
    .pill.error { border-color: var(--error-line); background: var(--error-soft); color: var(--error); }
    .workspace-shell { height: calc(100dvh - 58px); grid-template-columns: 280px minmax(0, 1fr); }
    .sessions-sidebar {
      border-right-color: var(--border);
      background: linear-gradient(180deg, var(--surface) 0%, var(--surface-soft) 100%);
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
    }
    .sessions-head { padding: 16px 12px 12px; border-bottom-color: var(--border); gap: 12px; }
    .sessions-head h2 { font-size: 13px; line-height: 1.2; font-weight: 800; color: var(--text); }
    .sessions-head .primary { width: 100%; }
    .session-list { gap: 8px; padding: 10px 10px 14px; overflow-y: auto; overflow-x: hidden; }
    .session-item {
      flex: 0 0 auto;
      min-height: 66px;
      border-color: var(--border);
      background: var(--surface);
      box-shadow: var(--shadow-sm);
      transition: transform .18s ease, border-color .18s ease, background .18s ease, box-shadow .18s ease;
    }
    .session-item:hover { transform: translateY(-1px); border-color: var(--border-strong); box-shadow: var(--shadow-md); }
    .session-item.active { border-color: var(--accent-line); background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent), var(--shadow-sm); }
    .session-open { min-height: 64px; align-content: center; gap: 5px; padding: 10px 10px 10px 12px; border-radius: var(--radius); box-shadow: none; }
    .session-open:hover, .session-open:focus-visible { background: transparent; box-shadow: none; transform: none; }
    .session-more { width: 30px; height: 30px; border-radius: var(--radius); color: var(--muted); background: var(--surface-soft); }
    .session-menu-wrap { padding-right: 8px; }
    .session-menu { right: 8px; top: 44px; z-index: 20; width: 116px; padding: 5px; border-color: var(--border); background: var(--surface); box-shadow: var(--shadow-md); }
    .session-menu button { box-shadow: none; }
    .session-menu button:hover { background: var(--accent-soft); transform: none; box-shadow: none; }
    .session-title { font-size: 13px; font-weight: 760; }
    .session-meta { color: var(--muted); font-weight: 560; }
    main { max-width: 1040px; padding: 22px clamp(16px, 3vw, 34px) 0; grid-template-rows: auto minmax(0, 1fr) auto; gap: 14px; }
    .case {
      background: rgba(253, 254, 255, .92);
      border-color: var(--border);
      border-radius: var(--radius);
      padding: 14px 16px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
      gap: 16px;
      box-shadow: var(--shadow-sm);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    @media (prefers-color-scheme: dark) { .case { background: rgba(23, 30, 42, .92); } }
    .case > div:first-child { min-width: 0; }
    .case-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    h1 { font-size: 17px; line-height: 1.32; font-weight: 800; letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .muted { color: var(--muted); font-size: 12px; }
    button {
      border-color: var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      box-shadow: var(--shadow-sm);
      transition: transform .16s ease, border-color .16s ease, background .16s ease, box-shadow .16s ease, color .16s ease;
    }
    button:hover { transform: translateY(-1px); border-color: var(--border-strong); background: var(--surface-soft); }
    button:active { transform: translateY(0); box-shadow: none; }
    button:focus-visible, textarea:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent-line); outline-offset: 2px; }
    button:disabled, textarea:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: .58; }
    button.primary { border-color: var(--accent); background: var(--accent); color: #fdfefe; box-shadow: 0 10px 22px rgba(45, 108, 223, .18); }
    button.primary:hover { border-color: var(--accent-hover); background: var(--accent-hover); }
    @media (prefers-color-scheme: dark) { button.primary { color: #0d1828; } }
    .chat { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 18px; scroll-behavior: smooth; }
    .chat:empty::before {
      content: "选择一个历史会话，或发起新的诊断";
      width: min(100%, 520px);
      margin: 12vh auto 0;
      padding: 18px;
      border: 1px dashed var(--border-strong);
      border-radius: var(--radius);
      color: var(--muted);
      text-align: center;
      background: rgba(253, 254, 255, .55);
    }
    .msg { max-width: min(760px, 82%); border-color: var(--border); border-radius: var(--radius); padding: 12px 14px; line-height: 1.68; background: var(--surface); box-shadow: var(--shadow-sm); }
    .msg.user { align-self: flex-end; margin-left: 0; background: var(--accent-soft); border-color: var(--accent-line); color: var(--text); }
    .msg.helper { align-self: flex-start; margin-right: 0; }
    .msg.error { border-color: var(--error-line); background: var(--error-soft); color: var(--error); }
    .msg.helper h1, .msg.helper h2, .msg.helper h3 { color: var(--text); white-space: normal; }
    .msg.helper code { background: var(--surface-strong); border-radius: 6px; font: 12px var(--font-mono); }
    .msg.helper pre { border-color: #263550; border-radius: var(--radius); background: #101828; font: 12px var(--font-mono); }
    .msg.helper strong { color: var(--accent); font-weight: 850; }
    .msg.thinking { color: var(--muted); }
    .msg.progress { width: min(720px, 90%); max-width: min(720px, 90%); padding: 0; border: 0; background: transparent; box-shadow: none; }
    .msg.progress.thinking { display: block; }
    .progress-card { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-sm); }
    .progress-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
    .progress-title { display: grid; gap: 3px; min-width: 0; }
    .progress-title strong { color: var(--text); font-size: 14px; font-weight: 800; }
    .progress-title span { color: var(--muted); font-size: 12px; line-height: 1.45; }
    .progress-percent { flex: 0 0 auto; color: var(--accent); font: 700 12px var(--font-mono); }
    .progress-track { height: 7px; border-radius: 999px; background: var(--surface-strong); overflow: hidden; }
    .progress-bar { display: block; height: 100%; width: 0%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), #72a8ff); transition: width .28s ease; }
    .progress-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .progress-step { min-width: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-soft); color: var(--muted); padding: 6px 7px; font-size: 11px; font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .progress-step.done { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent); }
    .progress-step.current { border-color: var(--accent); background: var(--surface); color: var(--text); }
    .progress-note { color: var(--muted); font-size: 12px; line-height: 1.55; }
    .progress-technical { display: grid; gap: 5px; padding-top: 10px; border-top: 1px solid var(--border); }
    .progress-technical span { min-width: 0; color: var(--muted); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
    .progress-technical strong { color: var(--accent); }
    .thinking-indicator span { background: var(--accent); }
    .activity-trace { padding-left: 10px; border-left: 2px solid var(--accent-line); }
    .activity-step { color: var(--muted); line-height: 1.7; }
    .activity-step strong { color: var(--accent); font-weight: 800; }
    .composer { background: rgba(253, 254, 255, .94); border-color: var(--border); border-radius: var(--radius) var(--radius) 0 0; box-shadow: 0 -12px 36px rgba(16, 24, 40, .08); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
    @media (prefers-color-scheme: dark) { .composer { background: rgba(23, 30, 42, .94); box-shadow: 0 -12px 36px rgba(0, 0, 0, .32); } }
    .composer:focus-within { border-color: var(--accent-line); }
    textarea { min-height: 82px; border: 1px solid transparent; border-radius: var(--radius); padding: 10px 11px; background: var(--surface-soft); color: var(--text); }
    textarea::placeholder { color: var(--soft); opacity: 1; }
    textarea:focus { border-color: var(--accent-line); background: var(--surface); }
    .composer-meta { gap: 7px; }
    .composer-meta .pill { min-height: 28px; max-width: none; background: var(--surface-soft); }
    .composer-actions { padding-top: 10px; border-top: 1px solid var(--border); }
    .persona-control { height: 36px; border-color: var(--border); border-radius: var(--radius); background: var(--surface-soft); }
    .persona-label { color: var(--muted); font-weight: 750; }
    .persona-control select { height: 30px; font-weight: 750; color: var(--text); }
    #sendButton { min-width: 66px; }
    .context-meter { min-width: min(440px, 100%); gap: 6px; }
    .context-meter-track { height: 6px; background: var(--surface-strong); }
    .context-meter-bar { background: var(--accent); }
    .context-meter.warn .context-meter-bar { background: var(--warn); }
    .context-meter.error .context-meter-bar { background: var(--error); }
    .context-meter-text { color: var(--muted); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .drawer { z-index: 30; }
    .shade { background: rgba(16, 24, 40, .38); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
    .drawer-panel { width: min(620px, 92vw); background: var(--surface); border-left: 1px solid var(--border); grid-template-rows: 58px minmax(0, 1fr); box-shadow: var(--shadow-drawer); }
    .drawer-head { border-bottom-color: var(--border); padding: 0 16px; background: var(--surface); }
    .drawer-head strong { font-size: 14px; font-weight: 800; }
    .logs, .settings-form { background: var(--surface-soft); }
    .log, .log-block, .status, .agent-card { border-color: var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-sm); }
    .log-block.ok { border-color: var(--ok-line); background: var(--ok-soft); }
    .log-block.warn { border-color: var(--warn-line); background: var(--warn-soft); }
    .log-block.error { border-color: var(--error-line); background: var(--error-soft); }
    .log-title { font-weight: 800; color: var(--text); }
    .log-title span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .log-label { background: rgba(253, 254, 255, .72); border-color: rgba(102, 112, 133, .22); color: var(--muted); }
    @media (prefers-color-scheme: dark) { .log-label { background: rgba(23, 30, 42, .72); } }
    .log-meta { color: var(--muted); font-family: var(--font-mono); }
    .log-command { border-color: #263550; border-radius: var(--radius); background: #101828; font: 11px var(--font-mono); }
    label { font-size: 12px; font-weight: 760; color: var(--text); }
    input, select { border-color: var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); }
    input::placeholder { color: var(--soft); opacity: 1; }
    .status { color: var(--muted); }
    .agent-card strong { color: var(--text); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

    /* compound workspace refresh */
    :root {
      --radius: 12px;
      --shadow-md: 0 6px 8px rgba(16, 24, 40, .07);
    }
    header {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
    }
    .topbar-left, .topbar-center, .topbar-actions {
      min-width: 0;
      display: flex;
      align-items: center;
    }
    .topbar-center { justify-content: center; }
    .topbar-actions { justify-content: flex-end; gap: 8px; }
    .workspace-pill {
      min-width: 0;
      max-width: min(54vw, 680px);
      display: inline-flex;
      align-items: center;
      height: 32px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: var(--shadow-sm);
    }
    .top-status {
      display: inline-flex;
      align-items: center;
      height: 32px;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-soft);
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .avatar-button {
      width: 34px;
      height: 34px;
      padding: 0;
      border-radius: 999px;
      border-color: var(--border-strong);
      background: var(--text);
      color: var(--surface);
      display: grid;
      place-items: center;
      font-weight: 850;
      box-shadow: none;
    }
    .avatar-button:hover { background: var(--text); color: var(--surface); }
    @media (prefers-color-scheme: dark) {
      .avatar-button { background: var(--surface-strong); color: var(--text); }
      .avatar-button:hover { background: var(--surface-strong); color: var(--text); }
    }
    .workspace-shell {
      grid-template-columns: 264px minmax(0, 1fr) 340px;
    }
    main {
      max-width: none;
      width: 100%;
      padding-inline: clamp(14px, 2vw, 22px);
    }
    .sessions-head {
      grid-template-columns: 1fr;
    }
    .session-search {
      width: 100%;
      height: 34px;
      background: var(--surface);
      font-size: 12px;
    }
    .session-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .session-filters button {
      height: 28px;
      padding: 0 9px;
      border-radius: 999px;
      box-shadow: none;
      color: var(--muted);
      background: var(--surface);
    }
    .session-filters button.active {
      border-color: var(--accent-line);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .session-state {
      display: inline-flex;
      width: max-content;
      max-width: 100%;
      align-items: center;
      min-height: 20px;
      padding: 0 7px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface-soft);
      color: var(--muted);
      font-size: 11px;
      font-weight: 750;
      line-height: 1.2;
    }
    .session-state.status-diagnosing,
    .session-state.status-ready_for_diagnosis {
      border-color: var(--accent-line);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .session-state.status-concluded {
      border-color: var(--ok-line);
      background: var(--ok-soft);
      color: var(--ok);
    }
    .session-state.status-need_input,
    .session-state.status-partial {
      border-color: var(--warn-line);
      background: var(--warn-soft);
      color: var(--warn);
    }
    .case-title-row {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .case-title-row h1 { min-width: 0; }
    .case-status {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 9px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-soft);
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
    }
    .case-status.status-concluded {
      border-color: var(--ok-line);
      background: var(--ok-soft);
      color: var(--ok);
    }
    .case-status.status-diagnosing,
    .case-status.status-ready_for_diagnosis {
      border-color: var(--accent-line);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .case-status.status-need_input,
    .case-status.status-partial {
      border-color: var(--warn-line);
      background: var(--warn-soft);
      color: var(--warn);
    }
    .case-step-rail {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 6px;
      margin-top: 10px;
    }
    .case-step {
      min-width: 0;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-soft);
      color: var(--muted);
      font-size: 11px;
      font-weight: 750;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .case-step.done {
      border-color: var(--accent-line);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .case-step.current {
      border-color: var(--accent);
      background: var(--surface);
      color: var(--text);
    }
    .chat {
      padding-inline: 38px;
    }
    .msg {
      position: relative;
      max-width: min(720px, 82%);
      border-radius: 14px;
    }
    .msg.user {
      margin-right: 34px;
      background: var(--accent);
      border-color: var(--accent);
      color: #fdfefe;
      box-shadow: none;
    }
    .msg.user::after,
    .msg.helper::before,
    .msg.progress::before {
      position: absolute;
      top: 2px;
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--muted);
      font-size: 12px;
      font-weight: 850;
      line-height: 1;
    }
    .msg.user::after {
      content: "我";
      right: -38px;
      border-color: var(--accent-line);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .msg.helper,
    .msg.progress {
      margin-left: 34px;
    }
    .msg.helper::before,
    .msg.progress::before {
      content: "H";
      left: -38px;
      border-color: var(--border-strong);
      color: var(--text);
    }
    .msg.user code {
      background: rgba(255, 255, 255, .18);
      color: #fdfefe;
    }
    .msg.progress {
      width: min(760px, 90%);
      max-width: min(760px, 90%);
      background: transparent;
    }
    .progress-card {
      border-radius: 14px;
    }
    .progress-steps {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
    .progress-skeleton {
      display: grid;
      gap: 7px;
      padding-top: 4px;
    }
    .progress-skeleton span {
      height: 8px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--surface-strong), var(--surface-soft), var(--surface-strong));
      background-size: 220% 100%;
      animation: skeleton-pan 1.4s ease-in-out infinite;
    }
    .progress-skeleton span:nth-child(2) { width: 82%; }
    .progress-skeleton span:nth-child(3) { width: 58%; }
    @keyframes skeleton-pan {
      0% { background-position: 100% 50%; }
      100% { background-position: 0 50%; }
    }
    .progress-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding-top: 2px;
    }
    .composer {
      border-radius: 16px 16px 0 0;
    }
    .composer-meta .pill {
      border-radius: 999px;
    }
    .insight-panel {
      min-height: 0;
      border-left: 1px solid var(--border);
      background: linear-gradient(180deg, var(--surface) 0%, var(--surface-soft) 100%);
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto;
    }
    .insight-head {
      padding: 16px 14px 10px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .insight-head strong {
      display: block;
      color: var(--text);
      font-size: 14px;
      font-weight: 850;
      line-height: 1.2;
    }
    .insight-head span {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .insight-tabs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      padding: 0 12px 12px;
      border-bottom: 1px solid var(--border);
    }
    .insight-tabs button {
      height: 32px;
      box-shadow: none;
    }
    .insight-tabs button.active {
      border-color: var(--accent-line);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .insight-content {
      min-height: 0;
      overflow: auto;
      padding: 12px;
      display: grid;
      align-content: start;
      gap: 10px;
    }
    .insight-footer {
      padding: 12px;
      border-top: 1px solid var(--border);
      background: var(--surface);
    }
    .insight-footer button {
      width: 100%;
    }
    .insight-card,
    .tree-card {
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--surface);
      padding: 11px;
      display: grid;
      gap: 8px;
      box-shadow: var(--shadow-sm);
    }
    .insight-card strong,
    .tree-card strong {
      color: var(--text);
      font-size: 13px;
      font-weight: 850;
    }
    .insight-card p,
    .tree-card p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.55;
    }
    .insight-meta {
      color: var(--muted);
      font: 700 11px var(--font-mono);
      overflow-wrap: anywhere;
    }
    .trace-list,
    .tree-list {
      display: grid;
      gap: 7px;
    }
    .trace-item,
    .tree-node {
      display: grid;
      gap: 3px;
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface-soft);
    }
    .trace-item.active,
    .tree-node.active {
      border-color: var(--accent-line);
      background: var(--accent-soft);
    }
    .trace-item strong,
    .tree-node strong {
      font-size: 12px;
    }
    .trace-item span,
    .tree-node span {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .evidence-row {
      display: grid;
      gap: 5px;
      padding: 9px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface-soft);
    }
    .evidence-row strong {
      color: var(--text);
      font-size: 12px;
      font-weight: 850;
    }
    .evidence-row span {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .placeholder-note {
      border-style: dashed;
      color: var(--muted);
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .001ms !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; }
    }
    @media (max-width: 1180px) {
      .workspace-shell { grid-template-columns: 248px minmax(0, 1fr); }
      .insight-panel { display: none; }
    }
    @media (max-width: 980px) {
      .workspace-shell { grid-template-columns: 248px minmax(0, 1fr); }
      main { padding-inline: 16px; }
      .case { grid-template-columns: 1fr; }
      .case-actions { justify-content: flex-start; }
    }
    @media (max-width: 820px) {
      header { padding-inline: 12px; }
      .workspace-shell { grid-template-columns: 1fr; grid-template-rows: 154px minmax(0, 1fr); }
      .sessions-sidebar { border-right: 0; border-bottom-color: var(--border); }
      .sessions-head .primary { width: auto; }
      .session-list { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px, 272px); overflow-x: auto; overflow-y: hidden; padding: 8px 10px 10px; }
      .session-item { min-height: 60px; }
      .session-open { min-height: 58px; }
    }
    @media (max-width: 700px) {
      main { padding: 12px 12px 0; gap: 10px; }
      .case { padding: 12px; }
      .case-actions button { flex: 1 1 auto; }
      .msg, .msg.progress { max-width: 100%; width: 100%; }
      .chat { padding-inline: 0; }
      .msg.user, .msg.helper, .msg.progress { margin-left: 0; margin-right: 0; }
      .msg.user::after, .msg.helper::before, .msg.progress::before { display: none; }
      h1, .context-meter-text { white-space: normal; }
      .progress-steps, .case-step-rail { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 520px) {
      #workspace { display: none; }
      .top-status, .topbar-actions > button:not(.avatar-button) { display: none; }
      .field-row { grid-template-columns: 1fr; }
      .drawer-panel { width: 100vw; }
    }

    /* design fidelity pass: follow the confirmed workspace mock more closely */
    :root {
      --bg: #eef2f6;
      --surface: #ffffff;
      --surface-soft: #f7f9fc;
      --surface-strong: #edf2f8;
      --text: #101828;
      --muted: #667085;
      --soft: #98a2b3;
      --border: #d8e0eb;
      --border-strong: #b8c7da;
      --accent: #2f6fed;
      --accent-hover: #245fcf;
      --accent-soft: #eef5ff;
      --accent-line: #bad5ff;
      --ok: #1f7a4d;
      --ok-soft: #effaf4;
      --ok-line: #a7d9bd;
      --warn: #a15c07;
      --warn-soft: #fff7e8;
      --warn-line: #efc978;
      --shadow-sm: 0 1px 2px rgba(16, 24, 40, .04);
      --shadow-md: 0 10px 24px rgba(16, 24, 40, .06);
      --radius: 12px;
    }
    body {
      background: var(--bg);
      color: var(--text);
    }
    .app { grid-template-rows: 64px minmax(0, 1fr); }
    header {
      height: 64px;
      padding: 0 18px;
      background: #fff;
      border-bottom: 1px solid var(--border);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
    .mark {
      width: 32px;
      height: 32px;
      border-radius: 9px;
      background: #2f6fed;
      box-shadow: none;
    }
    .brand-button {
      gap: 10px;
      height: 40px;
      color: #152033;
    }
    .brand-button:hover { background: #f3f6fa; }
    .workspace-pill {
      height: 34px;
      max-width: min(48vw, 620px);
      background: #fff;
      border-color: var(--border);
      box-shadow: 0 1px 2px rgba(16, 24, 40, .05);
      color: #526274;
    }
    .top-status { display: none; }
    .topbar-actions button:not(.avatar-button) {
      height: 36px;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 1px 2px rgba(16, 24, 40, .04);
    }
    .topbar-actions button:not(.avatar-button):hover {
      background: #f6f9fd;
      transform: none;
    }
    .avatar-button {
      width: 38px;
      height: 38px;
      border: 0;
      background: #111827;
      color: #fff;
      box-shadow: none;
    }
    .avatar-button:hover {
      transform: none;
      background: #111827;
      color: #fff;
    }
    .workspace-shell {
      height: calc(100dvh - 64px);
      grid-template-columns: 252px minmax(0, 1fr) 360px;
      background: var(--bg);
    }
    .sessions-sidebar {
      background: #fff;
      border-right: 1px solid var(--border);
      overflow: hidden;
    }
    .sessions-head {
      padding: 18px 12px 14px;
      border-bottom: 1px solid var(--border);
      gap: 12px;
    }
    .sessions-head h2 {
      font-size: 14px;
      line-height: 1;
    }
    .sessions-head .primary {
      height: 40px;
      border-radius: 10px;
      box-shadow: none;
    }
    .session-search {
      height: 36px;
      border-radius: 10px;
      background: #fff;
    }
    .session-filters { gap: 7px; }
    .session-filters button {
      height: 30px;
      border-radius: 999px;
      background: #fff;
    }
    .session-list {
      padding: 12px;
      gap: 10px;
      overflow-y: auto;
      overflow-x: hidden;
    }
    .session-item {
      flex: 0 0 auto;
      min-height: 72px;
      border-radius: 12px;
      border-color: #dce5f1;
      box-shadow: none;
    }
    .session-item:hover {
      transform: none;
      border-color: var(--border-strong);
      box-shadow: none;
    }
    .session-item.active {
      border-color: #9cc6ff;
      background: #f2f7ff;
      box-shadow: inset 0 0 0 1px rgba(47, 111, 237, .08);
    }
    .session-open {
      min-height: 70px;
      padding: 11px 10px 11px 12px;
      gap: 6px;
    }
    .session-title { font-size: 13px; }
    .session-state {
      min-height: 20px;
      padding-inline: 8px;
      background: #fff;
    }
    main {
      padding: 22px 24px 0;
      gap: 16px;
      background: var(--bg);
    }
    .case {
      padding: 18px 18px 16px;
      border-radius: 14px;
      background: #fff;
      border: 1px solid var(--border);
      box-shadow: none;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
    .case-title-row {
      gap: 10px;
      align-items: flex-start;
    }
    h1 {
      font-size: 18px;
      font-weight: 760;
      line-height: 1.35;
    }
    .case-status {
      min-height: 24px;
      padding-inline: 9px;
      border-radius: 999px;
      font-size: 12px;
      background: #f7f9fc;
    }
    .case-actions {
      gap: 8px;
      flex: 0 0 auto;
      position: relative;
    }
    .case-actions button {
      height: 36px;
      border-radius: 10px;
      box-shadow: none;
    }
    .case-actions button:hover { transform: none; }
    .case-actions .case-log-button {
      width: 40px;
      padding-inline: 0;
    }
    .case-actions .case-ticket-button {
      min-width: 76px;
    }
    .case-more {
      position: relative;
      flex: 0 0 auto;
    }
    .case-more summary {
      width: 40px;
      height: 36px;
      display: grid;
      place-items: center;
      border: 1px solid #d8e0eb;
      border-radius: 10px;
      background: #fff;
      color: #152033;
      font-size: 16px;
      font-weight: 800;
      line-height: 1;
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    .case-more summary::-webkit-details-marker {
      display: none;
    }
    .case-more summary:hover {
      background: #f6f9fd;
    }
    .case-more[open] summary {
      border-color: #bad5ff;
      background: #eef5ff;
      color: #245fcf;
    }
    .case-more-menu {
      position: absolute;
      right: 0;
      top: 42px;
      z-index: 22;
      width: 132px;
      display: grid;
      gap: 4px;
      padding: 6px;
      border: 1px solid #d8e0eb;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 14px 30px rgba(16, 24, 40, .12);
    }
    .case-more-menu button {
      width: 100%;
      height: 34px;
      justify-content: flex-start;
      text-align: left;
      border: 0;
      background: transparent;
      box-shadow: none;
      padding-inline: 9px;
    }
    .case-more-menu button:hover {
      background: #f3f7fc;
    }
    .case-step-rail {
      display: flex;
      gap: 8px;
      margin-top: 13px;
      overflow: hidden;
    }
    .case-step {
      flex: 0 1 auto;
      height: 28px;
      min-width: 76px;
      padding-inline: 10px;
      justify-content: center;
      border-radius: 999px;
      background: #f8fafc;
    }
    .case-step.current {
      border-color: #1f2937;
      color: #1f2937;
    }
    .context-meter {
      margin-top: 12px;
      min-width: 0;
      width: min(520px, 100%);
    }
    .context-meter-track {
      height: 6px;
      background: #edf2f8;
    }
    .chat {
      padding: 4px 44px 20px;
      gap: 16px;
    }
    .chat:empty::before {
      content: none;
      display: none;
    }
    .empty-workspace {
      width: min(100%, 680px);
      margin: 8vh auto 0;
      display: grid;
      gap: 14px;
      color: #667085;
    }
    .empty-card {
      display: grid;
      gap: 12px;
      padding: 18px;
      border: 1px solid #d8e0eb;
      border-radius: 16px;
      background: rgba(255, 255, 255, .72);
    }
    .empty-card strong {
      color: #152033;
      font-size: 16px;
      font-weight: 800;
      line-height: 1.35;
    }
    .empty-card p {
      margin: 0;
      max-width: 62ch;
      color: #667085;
      line-height: 1.65;
    }
    .empty-route {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
    }
    .empty-route span {
      min-height: 54px;
      display: grid;
      align-content: center;
      gap: 4px;
      padding: 9px;
      border: 1px solid #dce5f1;
      border-radius: 12px;
      background: #fff;
      color: #667085;
      font-size: 11px;
      line-height: 1.35;
    }
    .empty-route b {
      color: #152033;
      font-size: 12px;
    }
    .empty-sample {
      display: grid;
      gap: 10px;
      padding-inline: 8px;
    }
    .empty-sample span {
      width: max-content;
      max-width: min(560px, 84%);
      padding: 10px 12px;
      border-radius: 15px;
      border: 1px solid #dce5f1;
      background: #fff;
      color: #667085;
      line-height: 1.55;
    }
    .empty-sample span:last-child {
      justify-self: end;
      border-color: #2f6fed;
      background: #2f6fed;
      color: #fff;
    }
    .msg {
      max-width: min(760px, 82%);
      padding: 13px 15px;
      border-radius: 16px;
      border-color: #dce5f1;
      box-shadow: none;
      font-size: 14px;
      line-height: 1.72;
    }
    .msg.helper,
    .msg.progress {
      margin-left: 42px;
      background: #fff;
    }
    .msg.user {
      margin-right: 42px;
      background: #2f6fed;
      border-color: #2f6fed;
      color: #fff;
    }
    .msg.user::after,
    .msg.helper::before,
    .msg.progress::before {
      top: 0;
      width: 34px;
      height: 34px;
      border-color: #d8e0eb;
      box-shadow: none;
    }
    .msg.user::after {
      right: -44px;
      background: #111827;
      color: #fff;
      border-color: #111827;
    }
    .msg.helper::before,
    .msg.progress::before {
      left: -44px;
      background: #fff;
      color: #152033;
    }
    .progress-card {
      border-radius: 16px;
      padding: 16px;
      box-shadow: none;
      border-color: #dce5f1;
    }
    .progress-card-head {
      align-items: center;
    }
    .progress-title strong { font-size: 15px; }
    .progress-track { height: 8px; }
    .progress-bar { background: #2f6fed; }
    .progress-steps {
      gap: 8px;
    }
    .progress-step {
      height: 30px;
      padding-inline: 9px;
      border-radius: 999px;
      background: #f8fafc;
    }
    .progress-step.current {
      border-color: #111827;
      color: #111827;
    }
    .progress-actions button {
      height: 34px;
      border-radius: 10px;
      box-shadow: none;
    }
    .progress-card {
      position: relative;
      overflow: hidden;
    }
    .progress-card.is-active {
      border-color: #bad5ff;
      box-shadow: inset 0 0 0 1px rgba(47, 111, 237, .06);
    }
    .progress-card.is-active::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 -34%;
      width: 32%;
      pointer-events: none;
      background: linear-gradient(90deg, rgba(47, 111, 237, 0), rgba(47, 111, 237, .12), rgba(47, 111, 237, 0));
      opacity: .72;
      transform: translateX(-120%);
      animation: progress-sweep 2.7s cubic-bezier(.22, 1, .36, 1) infinite;
    }
    .progress-card.is-active > * {
      position: relative;
      z-index: 1;
    }
    .progress-title strong {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .progress-title-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .progress-live-dot {
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: #2f6fed;
      box-shadow: 0 0 0 4px rgba(47, 111, 237, .12);
      animation: progress-dot-pulse 1.35s ease-in-out infinite;
    }
    .progress-meter {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      color: #245fcf;
    }
    .progress-running {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: #245fcf;
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
    }
    .progress-running-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #2f6fed;
      animation: progress-running-pulse 1.1s ease-in-out infinite;
    }
    .progress-card.is-active .progress-track {
      position: relative;
    }
    .progress-card.is-active .progress-track::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      width: 34%;
      border-radius: inherit;
      background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, .72), rgba(255, 255, 255, 0));
      opacity: .7;
      transform: translateX(-130%);
      animation: progress-track-scan 1.65s ease-in-out infinite;
    }
    .progress-step.current {
      position: relative;
      overflow: hidden;
    }
    .progress-step.current::after {
      content: "";
      position: absolute;
      inset: 3px;
      border: 1px solid rgba(47, 111, 237, .24);
      border-radius: inherit;
      opacity: .8;
      transform: scale(.96);
      animation: progress-step-pulse 1.45s ease-in-out infinite;
    }
    @keyframes progress-sweep {
      0% { transform: translateX(-120%); opacity: 0; }
      18% { opacity: .72; }
      62% { opacity: .42; }
      100% { transform: translateX(430%); opacity: 0; }
    }
    @keyframes progress-dot-pulse {
      0%, 100% { transform: scale(.86); opacity: .64; }
      45% { transform: scale(1.18); opacity: 1; }
    }
    @keyframes progress-running-pulse {
      0%, 100% { transform: scale(.82); opacity: .48; }
      50% { transform: scale(1.15); opacity: 1; }
    }
    @keyframes progress-track-scan {
      0% { transform: translateX(-130%); opacity: 0; }
      18% { opacity: .72; }
      100% { transform: translateX(330%); opacity: 0; }
    }
    @keyframes progress-step-pulse {
      0%, 100% { transform: scale(.96); opacity: .18; }
      50% { transform: scale(1.02); opacity: .72; }
    }
    .composer {
      margin-bottom: 0;
      padding: 12px;
      border-radius: 16px 16px 0 0;
      border-color: #d8e0eb;
      background: #fff;
      box-shadow: 0 -12px 38px rgba(16, 24, 40, .08);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
    textarea {
      min-height: 88px;
      border-radius: 12px;
      background: #f8fafc;
      color: #152033;
    }
    textarea:focus {
      background: #fff;
      border-color: #bad5ff;
    }
    .composer-actions {
      padding-top: 11px;
      border-top-color: #d8e0eb;
    }
    .composer-meta .pill,
    .persona-control {
      background: #fff;
      border-color: #d8e0eb;
    }
    #sendButton {
      height: 38px;
      min-width: 70px;
      border-radius: 10px;
      box-shadow: none;
    }
    .insight-panel {
      background: #fff;
      border-left: 1px solid var(--border);
      grid-template-rows: auto auto minmax(0, 1fr) auto;
    }
    .insight-head {
      padding: 18px 16px 12px;
      border-bottom: 0;
    }
    .insight-head strong {
      font-size: 15px;
      letter-spacing: 0;
    }
    .insight-head span {
      margin-top: 5px;
      color: #667085;
    }
    .insight-tabs {
      padding: 0 14px 14px;
      gap: 8px;
      border-bottom-color: #d8e0eb;
    }
    .insight-tabs button {
      height: 34px;
      border-radius: 12px;
      background: #fff;
      box-shadow: none;
    }
    .insight-tabs button.active {
      border-color: #9cc6ff;
      background: #eef5ff;
      color: #245fcf;
    }
    .insight-content {
      padding: 14px;
      gap: 12px;
    }
    .insight-card,
    .tree-card {
      border-radius: 14px;
      border-color: #dce5f1;
      box-shadow: none;
      padding: 13px;
    }
    .insight-card strong,
    .tree-card strong {
      font-size: 13px;
    }
    .trace-map,
    .knowledge-map {
      position: relative;
      display: grid;
      gap: 10px;
      padding-left: 18px;
    }
    .trace-map::before,
    .knowledge-map::before {
      content: "";
      position: absolute;
      left: 7px;
      top: 9px;
      bottom: 9px;
      width: 1px;
      background: #d8e0eb;
    }
    .trace-node,
    .knowledge-node {
      position: relative;
      display: grid;
      gap: 4px;
      padding: 10px 11px;
      border: 1px solid #dce5f1;
      border-radius: 12px;
      background: #f8fafc;
    }
    .trace-node::before,
    .knowledge-node::before {
      content: "";
      position: absolute;
      left: -15px;
      top: 16px;
      width: 9px;
      height: 9px;
      border: 2px solid #c6d3e4;
      border-radius: 999px;
      background: #fff;
    }
    .trace-node.active,
    .knowledge-node.active {
      border-color: #9cc6ff;
      background: #eef5ff;
    }
    .trace-node.active::before,
    .knowledge-node.active::before {
      border-color: #2f6fed;
      background: #2f6fed;
    }
    .trace-node strong,
    .knowledge-node strong {
      color: #152033;
      font-size: 12px;
      font-weight: 800;
    }
    .trace-node span,
    .knowledge-node span {
      color: #667085;
      font-size: 11px;
      line-height: 1.55;
      overflow-wrap: anywhere;
    }
    .knowledge-branch {
      display: grid;
      grid-template-columns: 1fr auto 1fr auto 1fr;
      align-items: center;
      gap: 6px;
      padding: 10px;
      border: 1px solid #dce5f1;
      border-radius: 12px;
      background: #fff;
      color: #667085;
      font-size: 11px;
      line-height: 1.35;
    }
    .knowledge-branch strong {
      color: #152033;
      font-size: 11px;
    }
    .knowledge-branch em {
      font-style: normal;
      color: #98a2b3;
    }
    .knowledge-status-chip {
      min-height: 26px;
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      border: 1px solid #d8e0eb;
      padding: 0 9px;
      font-size: 11px;
      font-weight: 800;
      background: #f8fafc;
      color: #667085;
    }
    .knowledge-status-chip.ok { border-color: #9fd6b2; background: #f1fbf5; color: #247a43; }
    .knowledge-status-chip.warn { border-color: #efca82; background: #fff7e8; color: #b96f10; }
    .knowledge-status-chip.error { border-color: #f5b5af; background: #fff4f3; color: #b42318; }
    .knowledge-status-chip.off { border-color: #d8e0eb; background: #f8fafc; color: #667085; }
    .knowledge-health-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .health-tile {
      min-width: 0;
      display: grid;
      gap: 5px;
      padding: 11px;
      border: 1px solid #dce5f1;
      border-radius: 12px;
      background: #fff;
    }
    .health-tile span {
      color: #667085;
      font-size: 11px;
      font-weight: 750;
    }
    .health-tile strong {
      font-size: 13px;
      font-weight: 850;
      overflow-wrap: anywhere;
    }
    .health-tile.ok { border-color: #9fd6b2; background: #f4fbf6; }
    .health-tile.warn { border-color: #efca82; background: #fff9ea; }
    .health-tile.error { border-color: #f5b5af; background: #fff5f4; }
    .health-tile.off { background: #f8fafc; }
    .health-alert {
      display: grid;
      gap: 8px;
      border: 1px solid #f5b5af;
      border-radius: 12px;
      background: #fff4f3;
      padding: 12px;
      color: #7a271a;
      font-size: 12px;
      line-height: 1.55;
    }
    .health-code {
      display: inline-flex;
      width: fit-content;
      max-width: 100%;
      border: 1px solid rgba(122, 39, 26, .18);
      border-radius: 7px;
      padding: 3px 7px;
      background: rgba(255,255,255,.68);
      color: #7a271a;
      font-family: var(--font-mono);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .health-tree {
      position: relative;
      display: grid;
      gap: 9px;
      padding-left: 18px;
    }
    .health-tree::before {
      content: "";
      position: absolute;
      left: 7px;
      top: 9px;
      bottom: 9px;
      width: 1px;
      background: #d8e0eb;
    }
    .health-node {
      position: relative;
      display: grid;
      gap: 4px;
      padding: 10px 11px;
      border: 1px solid #dce5f1;
      border-radius: 12px;
      background: #fff;
      min-width: 0;
    }
    .health-node::before {
      content: "";
      position: absolute;
      left: -15px;
      top: 16px;
      width: 9px;
      height: 9px;
      border: 2px solid #c6d3e4;
      border-radius: 999px;
      background: #fff;
    }
    .health-node.ok { border-color: #9fd6b2; background: #f4fbf6; }
    .health-node.ok::before { border-color: #2e9d55; background: #2e9d55; }
    .health-node.warn { border-color: #efca82; background: #fff9ea; }
    .health-node.warn::before { border-color: #d99118; background: #d99118; }
    .health-node.error { border-color: #f5b5af; background: #fff5f4; }
    .health-node.error::before { border-color: #d64545; background: #d64545; }
    .health-node.off { background: #f8fafc; }
    .health-node strong {
      font-size: 12px;
      font-weight: 850;
      color: #152033;
    }
    .health-node span {
      color: #667085;
      font-size: 11px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .health-row {
      display: grid;
      gap: 7px;
      border-top: 1px solid #e5ebf2;
      margin-top: 8px;
      padding-top: 9px;
      font-size: 12px;
      color: #667085;
    }
    .health-row b {
      color: #152033;
      font-weight: 800;
    }
    .health-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .health-actions button {
      min-width: 0;
      padding: 0 8px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .evidence-row {
      border-radius: 12px;
      border-color: #dce5f1;
      background: #f8fafc;
    }
    .placeholder-note {
      border-style: dashed;
      background: #fbfcfe;
    }
    .insight-footer {
      padding: 12px 14px;
      border-top-color: #d8e0eb;
    }
    .insight-footer button {
      height: 38px;
      border-radius: 12px;
      box-shadow: none;
    }
    @media (prefers-color-scheme: dark) {
      header,
      .sessions-sidebar,
      .case,
      .composer,
      .insight-panel,
      .msg.helper,
      .progress-card {
        background: #fff;
        color: #101828;
      }
      body,
      .workspace-shell,
      main {
        background: #eef2f6;
        color: #101828;
      }
      .avatar-button,
      .avatar-button:hover,
      .msg.user::after {
        background: #111827;
        color: #fff;
      }
      button.primary,
      button.primary:hover {
        color: #fff;
      }
    }
    @media (max-width: 1240px) {
      .workspace-shell { grid-template-columns: 248px minmax(0, 1fr); }
      .insight-panel { display: none; }
      .chat { padding-inline: 34px; }
    }
    @media (max-width: 820px) {
      .app { grid-template-rows: 58px minmax(0, 1fr); }
      header { height: 58px; }
      .workspace-shell { height: calc(100dvh - 58px); }
      main { padding: 14px 12px 0; }
      .chat { padding-inline: 0; }
      .case-step-rail { flex-wrap: wrap; }
      .case {
        grid-template-columns: 1fr;
      }
      .case-actions {
        justify-content: flex-start;
      }
      .case-actions button,
      .case-more {
        flex: 0 0 auto;
      }
      .case-more-menu button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div class="topbar-left">
        <button class="brand-button" onclick="openSettings()" title="打开配置"><div class="mark">H</div><span>super helper</span></button>
      </div>
      <div class="topbar-center">
        <span class="workspace-pill" id="workspace">workspace loading...</span>
      </div>
      <div class="topbar-actions">
        <span class="top-status">知识库审计预留</span>
        <button onclick="openTicketDraft()">升级工单</button>
        <button class="avatar-button" onclick="openAccountPlaceholder()" title="用户系统预留">访</button>
      </div>
    </header>
    <div class="workspace-shell">
      <aside class="sessions-sidebar">
        <div class="sessions-head">
          <h2>历史会话</h2>
          <button class="primary" onclick="newCase()">新建诊断</button>
          <label class="sr-only" for="sessionSearch">搜索会话</label>
          <input id="sessionSearch" class="session-search" placeholder="搜索 case 或结论" />
          <div class="session-filters" aria-label="会话筛选">
            <button class="active" id="sessionFilter-all" onclick="setSessionFilter('all')">全部</button>
            <button id="sessionFilter-active" onclick="setSessionFilter('active')">处理中</button>
            <button id="sessionFilter-concluded" onclick="setSessionFilter('concluded')">已有结论</button>
            <button id="sessionFilter-need_input" onclick="setSessionFilter('need_input')">待补充</button>
          </div>
        </div>
        <div class="session-list" id="sessionList"><div class="muted">正在加载...</div></div>
      </aside>
      <main>
        <section class="case">
          <div>
            <div class="case-title-row">
              <h1 id="title">新对话</h1>
              <span class="case-status status-collecting_input" id="caseStatus">新建</span>
              <span class="knowledge-status-chip off" id="knowledgeStatus">知识库待检查</span>
            </div>
            <div class="muted" id="meta">本地会话，helper agent 会先审核上下文，再决定追问或调用 Claude Code</div>
            <div class="case-step-rail" id="caseStepRail"></div>
            <div class="context-meter" id="contextMeter">
              <div class="context-meter-track"><div class="context-meter-bar" id="contextMeterBar"></div></div>
              <div class="context-meter-text" id="contextMeterText">上下文窗口：等待会话初始化</div>
            </div>
          </div>
          <div class="case-actions">
            <button class="case-log-button" onclick="openLogs()" title="查看诊断日志">日志</button>
            <button class="case-ticket-button" onclick="openTicketDraft()">升级工单</button>
            <details class="case-more">
              <summary title="更多操作" aria-label="更多操作">...</summary>
              <div class="case-more-menu">
                <button onclick="openSettings()">配置</button>
                <button onclick="markResolvedPlaceholder()">标记已解决</button>
                <button onclick="newCase()">新建诊断</button>
              </div>
            </details>
          </div>
        </section>
        <section class="chat" id="chat"></section>
        <section class="composer">
          <label class="sr-only" for="input">输入问题</label>
          <textarea id="input" placeholder="可以问项目问题、描述故障、回答追问，或输入：不清楚"></textarea>
          <div class="composer-meta status-pills"><span class="pill">Agent 审核</span><span class="pill">session 复用</span><span class="pill">Claude 只读</span></div>
          <div class="composer-actions">
            <div class="persona-control"><span class="persona-label">用户视角</span><select id="personaSelect" aria-label="用户视角"><option value="operations">运营人员</option><option value="support">技术支持</option><option value="customer">客户</option><option value="developer">开发人员</option></select></div>
            <button class="primary" id="sendButton" onclick="send()">发送</button>
          </div>
        </section>
      </main>
      <aside class="insight-panel" id="insightPanel">
        <div class="insight-head">
          <div>
            <strong>诊断审计</strong>
            <span id="insightSubhead">知识健康与证据路线</span>
          </div>
        </div>
        <div class="insight-tabs" role="tablist" aria-label="诊断审计视图">
          <button class="active" id="insightTab-progress" onclick="setInsightTab('progress')">进度</button>
          <button id="insightTab-evidence" onclick="setInsightTab('evidence')">证据</button>
          <button id="insightTab-health" onclick="setInsightTab('health')">知识健康</button>
        </div>
        <div class="insight-content" id="insightContent"></div>
        <div class="insight-footer">
          <button onclick="openTicketDraft()">升级工单</button>
        </div>
      </aside>
    </div>
  </div>
  <div class="drawer" id="drawer">
    <div class="shade" onclick="closeLogs()"></div>
    <div class="drawer-panel">
      <div class="drawer-head"><strong>诊断日志</strong><div class="drawer-actions"><button onclick="refreshLogs()">刷新</button><button onclick="closeLogs()">关闭</button></div></div>
      <div class="logs" id="logs"></div>
    </div>
  </div>
  <div class="drawer" id="settingsDrawer">
    <div class="shade" onclick="closeSettings()"></div>
    <div class="drawer-panel">
      <div class="drawer-head"><strong>配置</strong><button onclick="closeSettings()">关闭</button></div>
      <div class="settings-form">
        <div class="field-row">
          <label>Provider ID<input id="providerId" value="minimax" /></label>
          <label>模型<input id="modelId" value="MiniMax-M3" /></label>
        </div>
        <label>Base URL<input id="baseUrl" value="https://api.minimaxi.com/v1" /></label>
        <div class="field-row">
          <label>API 类型<select id="apiType"><option value="openai-completions">openai-completions</option><option value="openai-chat-completions">openai-chat-completions</option></select></label>
          <label>API Key 环境变量<input id="apiKeyEnv" value="MINIMAX_API_KEY" /></label>
        </div>
        <label>API Key<input id="apiKey" type="password" autocomplete="off" placeholder="可选：仅本次保存或测试使用" /></label>
        <div class="field-row">
          <label>Max Tokens<input id="maxTokens" type="number" value="1200" /></label>
          <label>Temperature<input id="temperature" type="number" step="0.1" value="0" /></label>
        </div>
        <label>上下文窗口 Tokens<input id="contextWindowTokens" type="number" value="1000000" /></label>
        <h3 style="margin: 8px 0 0; font-size: 14px;">Embedding 模型</h3>
        <label><input id="embeddingEnabled" type="checkbox" /> 启用 Embedding</label>
        <div class="field-row">
          <label>Provider<input id="embeddingProvider" value="siliconflow" /></label>
          <label>模型<input id="embeddingModel" value="Qwen/Qwen3-Embedding-0.6B" /></label>
        </div>
        <label>Base URL<input id="embeddingBaseUrl" value="https://api.siliconflow.cn/v1" /></label>
        <div class="field-row">
          <label>API Key 环境变量<input id="embeddingApiKeyEnv" value="SILICONFLOW_API_KEY" /></label>
          <label>维度<input id="embeddingDimensions" type="number" value="1024" /></label>
        </div>
        <label>API Key<input id="embeddingApiKey" type="password" autocomplete="off" placeholder="可选：仅本次保存或测试使用" /></label>
        <h3 style="margin: 8px 0 0; font-size: 14px;">Rerank 模型</h3>
        <label><input id="rerankEnabled" type="checkbox" /> 启用 Rerank</label>
        <div class="field-row">
          <label>Provider<input id="rerankProvider" value="siliconflow" /></label>
          <label>模型<input id="rerankModel" value="BAAI/bge-reranker-v2-m3" /></label>
        </div>
        <label>Base URL<input id="rerankBaseUrl" value="https://api.siliconflow.cn/v1" /></label>
        <div class="field-row">
          <label>API Key 环境变量<input id="rerankApiKeyEnv" value="SILICONFLOW_API_KEY" /></label>
          <label>Top N<input id="rerankTopN" type="number" value="8" /></label>
        </div>
        <label>API Key<input id="rerankApiKey" type="password" autocomplete="off" placeholder="可选：仅本次保存或测试使用" /></label>
        <div class="field-row">
          <label>Claude 超时毫秒<input id="claudeTimeoutMs" type="number" value="1200000" /></label>
          <label>Claude 预算 USD<input id="claudeMaxBudgetUsd" type="number" step="0.01" placeholder="不限制" /></label>
        </div>
        <div class="field-row">
          <label>Session busy 重试次数<input id="sessionBusyMaxRetries" type="number" value="3" /></label>
          <label>Session busy 重试间隔毫秒<input id="sessionBusyRetryDelayMs" type="number" value="3000" /></label>
        </div>
        <div class="tools">
          <button class="primary" onclick="testModel()">测试模型</button>
          <button onclick="testEmbedding()">测试 Embedding</button>
          <button onclick="testRerank()">测试 Rerank</button>
          <button onclick="saveSettings()">保存配置</button>
        </div>
        <div class="status" id="settingsStatus">点击测试模型，确认 Agent 模型是否可用。</div>
        <div>
          <h3 style="margin: 4px 0 8px; font-size: 14px;">多 Agent 设置</h3>
          <div class="agent-list" id="agentSettings"><div class="muted">正在加载 Agent 设置...</div></div>
        </div>
      </div>
    </div>
  </div>
  <script>
    let caseId = localStorage.getItem('super-helper.caseId') || '';
    const chat = document.getElementById('chat');
    const input = document.getElementById('input');
    const sessionList = document.getElementById('sessionList');
    const sessionSearch = document.getElementById('sessionSearch');
    const personaSelect = document.getElementById('personaSelect');
    const sendButton = document.getElementById('sendButton');
    let currentSession = null;
    let sessionFilter = 'all';
    let activeInsightTab = 'progress';
    let ticketDraftNotice = '';
    let knowledgeActionNotice = '';

    async function loadConfig() {
      const res = await fetch('/api/config');
      const json = await res.json();
      const workspace = document.getElementById('workspace');
      const workspaceText = json.workspace.name + ' · ' + json.workspace.rootPath;
      workspace.textContent = workspaceText;
      workspace.title = workspaceText;
    }

    async function loadSettings() {
      const res = await fetch('/api/settings');
      const json = await res.json();
      const providerId = json.agent.modelProvider || Object.keys(json.models.providers)[0] || 'minimax';
      const provider = json.models.providers[providerId] || {};
      document.getElementById('providerId').value = providerId;
      document.getElementById('baseUrl').value = provider.baseUrl || 'https://api.minimaxi.com/v1';
      document.getElementById('apiType').value = provider.api || 'openai-completions';
      document.getElementById('apiKeyEnv').value = provider.apiKeyEnv || 'MINIMAX_API_KEY';
      document.getElementById('modelId').value = provider.model || 'MiniMax-M3';
      document.getElementById('maxTokens').value = provider.maxTokens || 1200;
      document.getElementById('contextWindowTokens').value = provider.contextWindowTokens || json.agent.contextWindowTokens || 200000;
      document.getElementById('temperature').value = provider.temperature ?? 0;
      const embedding = json.embedding || {};
      document.getElementById('embeddingEnabled').checked = Boolean(embedding.enabled);
      document.getElementById('embeddingProvider').value = embedding.provider || 'siliconflow';
      document.getElementById('embeddingModel').value = embedding.model || 'Qwen/Qwen3-Embedding-0.6B';
      document.getElementById('embeddingBaseUrl').value = embedding.baseUrl || 'https://api.siliconflow.cn/v1';
      document.getElementById('embeddingApiKeyEnv').value = embedding.apiKeyEnv || 'SILICONFLOW_API_KEY';
      document.getElementById('embeddingDimensions').value = embedding.dimensions || 1024;
      const rerank = json.rerank || {};
      document.getElementById('rerankEnabled').checked = Boolean(rerank.enabled);
      document.getElementById('rerankProvider').value = rerank.provider || 'siliconflow';
      document.getElementById('rerankModel').value = rerank.model || 'BAAI/bge-reranker-v2-m3';
      document.getElementById('rerankBaseUrl').value = rerank.baseUrl || 'https://api.siliconflow.cn/v1';
      document.getElementById('rerankApiKeyEnv').value = rerank.apiKeyEnv || 'SILICONFLOW_API_KEY';
      document.getElementById('rerankTopN').value = rerank.topN || 8;
      document.getElementById('claudeTimeoutMs').value = json.claude.timeoutMs ?? 1200000;
      document.getElementById('claudeMaxBudgetUsd').value = json.claude.maxBudgetUsd ?? '';
      document.getElementById('sessionBusyMaxRetries').value = json.claude.sessionBusyMaxRetries ?? 3;
      document.getElementById('sessionBusyRetryDelayMs').value = json.claude.sessionBusyRetryDelayMs ?? 3000;
      document.getElementById('settingsStatus').textContent = provider.hasApiKey ? '已检测到 API Key 配置，可以测试模型。' : '未检测到 API Key。请设置环境变量或临时输入 API Key 后测试。';
      await loadAgents();
    }

    async function loadAgents() {
      const target = document.getElementById('agentSettings');
      const res = await fetch('/api/agents');
      const json = await res.json();
      const agents = json.agents || [];
      target.innerHTML = agents.length
        ? agents.map((agent) => '<div class="agent-card"><strong>' + escapeHtml(agent.title || agent.id) + '</strong><div>' + escapeHtml(agent.stage) + ' · ' + escapeHtml(agent.role) + '</div><div>' + escapeHtml(agent.summary || agent.responsibility || '') + '</div><div class="muted">' + escapeHtml(agent.configPath) + ' · 执行模式：' + escapeHtml(agent.executionMode || '未声明') + ' · 用户可见文本：' + (agent.mayProduceUserFacingText ? '允许' : '不允许') + '</div></div>').join('')
        : '<div class="muted">没有配置 Agent。</div>';
    }

    function add(role, body, options = {}) {
      const empty = document.getElementById('emptyChat');
      if (empty) {
        empty.remove();
      }
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      if (role.includes('helper') && !role.includes('thinking') && options.rich !== false) {
        div.innerHTML = renderHelperMessage(body, options.result);
      } else {
        div.textContent = body;
      }
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
      return div;
    }

    function showEmptyChat() {
      if (!chat || chat.children.length) {
        return;
      }
      chat.innerHTML = '<div class="empty-workspace" id="emptyChat">'
        + '<div class="empty-card"><strong>准备开始一次诊断</strong><p>把问题、现象或排查目标发过来。super helper 会先整理上下文，再决定追问、查知识库或调用只读诊断工具。</p><div class="empty-route"><span><b>理解问题</b>提取对象和未知项</span><span><b>知识路由</b>定位模块和意图</span><span><b>检索证据</b>查 FAQ 与 Runbook</span><span><b>证据判断</b>区分事实和推断</span><span><b>生成答复</b>给出下一步</span></div></div>'
        + '<div class="empty-sample"><span>示例：学员管理统计缺少 6 月数据，定时任务已恢复，怎么补数据？</span><span>发送后展示稳定进度，不再用跳动文案等待。</span></div>'
        + '</div>';
    }

    function addThinking() {
      const div = add('helper thinking progress', '');
      div.innerHTML = renderProgressActivity({ status: 'ready_for_diagnosis', userPersona: personaSelect.value, agentActivity: [] });
      return div;
    }

    function setCaseHeader(session) {
      currentSession = session || null;
      const title = document.getElementById('title');
      const meta = document.getElementById('meta');
      const status = document.getElementById('caseStatus');
      const knowledgeStatus = document.getElementById('knowledgeStatus');
      const titleText = session?.title || '新对话';
      const metaText = session?.id
        ? session.id + ' / ' + statusLabel(session.status, session) + ' / ' + personaLabel(session.userPersona || personaSelect.value) + ' / 同案上下文连续'
        : '本地会话，helper agent 会先审核上下文，再决定追问或调用 Claude Code';
      title.textContent = titleText;
      title.title = titleText;
      meta.textContent = metaText;
      meta.title = metaText;
      const statusValue = session?.archivedAt ? 'archived' : session?.status || 'collecting_input';
      status.textContent = statusLabel(statusValue, session);
      status.className = 'case-status status-' + normalizeStatusClass(statusValue);
      const knowledgeHealth = session?.knowledgeHealth;
      if (knowledgeStatus) {
        const healthStatus = knowledgeHealth?.serviceBinding?.status || 'off';
        knowledgeStatus.textContent = knowledgeHeaderLabel(knowledgeHealth);
        knowledgeStatus.className = 'knowledge-status-chip ' + healthStatusClass(healthStatus);
        knowledgeStatus.title = knowledgeHealth?.serviceBinding?.message || '知识库状态会在打开会话后检查';
      }
      if (session?.userPersona) {
        personaSelect.value = session.userPersona;
      }
      renderCaseStepRail(session);
      updateContextMeter(session?.contextUsage);
      updateInsightPanel(session);
      if (session?.archivedAt) {
        input.disabled = true;
        sendButton.disabled = true;
        input.placeholder = '这个会话已归档，只能阅读，不能继续追问';
      } else {
        input.placeholder = '可以问项目问题、描述故障、回答追问，或输入：不清楚';
      }
    }

    function updateContextMeter(contextUsage) {
      const meter = document.getElementById('contextMeter');
      const bar = document.getElementById('contextMeterBar');
      const text = document.getElementById('contextMeterText');
      const usage = contextUsage || { percent: 0, estimatedTokens: 0, limitTokens: 0, level: 'ok', available: true };
      meter.className = 'context-meter ' + usage.level;
      bar.style.width = Math.min(100, usage.percent || 0) + '%';
      text.textContent = usage.limitTokens
        ? '上下文窗口：约 ' + usage.estimatedTokens + ' / ' + usage.limitTokens + ' tokens（' + usage.percent + '%）'
        : '上下文窗口：等待会话初始化';
      const unavailable = usage.available === false;
      input.disabled = unavailable;
      sendButton.disabled = unavailable;
      if (unavailable) {
        text.textContent += '，当前会话已满，请开启新对话';
      }
      meter.title = text.textContent;
      text.title = text.textContent;
    }

    async function loadSessions() {
      const res = await fetch('/api/sessions');
      const json = await res.json();
      const allSessions = json.sessions || [];
      const keyword = (sessionSearch?.value || '').trim().toLowerCase();
      const sessions = allSessions.filter((session) => {
        const matchesFilter = sessionFilter === 'all'
          || (sessionFilter === 'active' && ['diagnosing', 'ready_for_diagnosis'].includes(session.status))
          || session.status === sessionFilter;
        const text = [session.title, session.lastMessage, session.id, statusLabel(session.status, session)].filter(Boolean).join(' ').toLowerCase();
        return matchesFilter && (!keyword || text.includes(keyword));
      });
      sessionList.innerHTML = sessions.length
        ? sessions.map((session) => {
          const title = session.title || '新对话';
          const state = session.archivedAt ? '已归档' : statusLabel(session.status, session);
          const statePrefix = session.pinnedAt ? '置顶 / ' : '';
          const meta = statePrefix + state + ' / ' + (session.lastMessage || '暂无消息');
          const pinAction = session.pinnedAt ? 'unpin' : 'pin';
          const pinLabel = session.pinnedAt ? '取消置顶' : '置顶';
          return '<div class="session-item ' + (session.id === caseId ? 'active' : '') + '" data-session-id="' + escapeHtml(session.id) + '" title="' + escapeHtml(title + '\\n' + meta) + '"><button class="session-open" onclick="openSession(\\'' + escapeHtml(session.id) + '\\')"><span class="session-title" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</span><span class="session-state status-' + escapeHtml(normalizeStatusClass(session.archivedAt ? 'archived' : session.status)) + '">' + escapeHtml(state) + '</span><span class="session-meta" title="' + escapeHtml(meta) + '">' + escapeHtml(meta) + '</span></button><div class="session-menu-wrap"><button class="session-more" onclick="toggleSessionMenu(event, \\'' + escapeHtml(session.id) + '\\')" title="更多选项">...</button><div class="session-menu" id="session-menu-' + escapeHtml(session.id) + '"><button onclick="sessionAction(event, \\'' + escapeHtml(session.id) + '\\', \\'' + pinAction + '\\')">' + pinLabel + '</button><button onclick="sessionAction(event, \\'' + escapeHtml(session.id) + '\\', \\'archive\\')">归档</button><button onclick="sessionAction(event, \\'' + escapeHtml(session.id) + '\\', \\'delete\\')">删除</button></div></div></div>';
        }).join('')
        : '<div class="muted">' + (allSessions.length ? '没有符合筛选的会话。' : '还没有历史会话。') + '</div>';
    }

    function loadSessionsInBackground() {
      loadSessions().catch(() => {});
    }

    function markActiveSession(id) {
      document.querySelectorAll('.session-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.sessionId === id);
      });
    }

    function toggleSessionMenu(event, id) {
      event.stopPropagation();
      const menuId = 'session-menu-' + id;
      document.querySelectorAll('.session-menu.open').forEach((menu) => {
        if (menu.id !== menuId) {
          menu.classList.remove('open');
        }
      });
      const menu = document.getElementById(menuId);
      if (menu) {
        menu.classList.toggle('open');
      }
    }

    async function sessionAction(event, id, action) {
      event.stopPropagation();
      if (action === 'delete') {
        const res = await fetch('/api/session?caseId=' + encodeURIComponent(id), { method: 'DELETE' });
        if (res.ok && id === caseId) {
          caseId = '';
          localStorage.removeItem('super-helper.caseId');
          chat.innerHTML = '';
          setCaseHeader();
          showEmptyChat();
        }
      } else {
        await fetch('/api/session', {
          method: 'PATCH',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({ caseId: id, action })
        });
      }
      await loadSessions();
      if (caseId) {
        await openSession(caseId).catch(() => {});
      }
    }

    async function openSession(id) {
      const res = await fetch(lightweightSessionUrl(id));
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'session load failed');
      }
      caseId = json.session.id;
      localStorage.setItem('super-helper.caseId', caseId);
      markActiveSession(caseId);
      chat.innerHTML = '';
      for (const message of json.session.messages || []) {
        add(message.role === 'user' ? 'user' : 'helper', message.body, {
          result: message.role === 'helper' ? findRunResultForMessage(json.session, message) : undefined,
        });
      }
      if (!(json.session.messages || []).length) {
        showEmptyChat();
      }
      setCaseHeader(json.session);
      restorePendingTurn(json.session);
      loadSessionsInBackground();
      refreshCurrentKnowledgeHealth(json.session).catch(() => {});
    }

    function restorePendingTurn(session) {
      if (!isSessionInProgress(session)) {
        return;
      }
      const pendingUserMessage = latestPendingUserMessage(session.messages || []);
      if (!pendingUserMessage) {
        return;
      }
      const pending = addThinking();
      pollSessionUntilSettled(pending, session.id, pendingUserMessage.id).catch((error) => {
        if (session.id !== caseId) {
          return;
        }
        pending.classList.remove('thinking', 'progress');
        pending.classList.add('error');
        pending.textContent = '请求中断了，我没有继续假装思考。\\n\\n原因：' + errorMessage(error) + '\\n\\n你可以打开“查看诊断日志”看详细链路，或直接重试。';
      });
    }

    function isSessionInProgress(session) {
      return ['diagnosing', 'ready_for_diagnosis'].includes(session?.status);
    }

    function latestPendingUserMessage(messages) {
      const answered = new Set((messages || [])
        .filter((message) => message.role === 'helper' && message.replyToMessageId)
        .map((message) => message.replyToMessageId));
      return [...(messages || [])].reverse().find((message) => message.role === 'user' && !answered.has(message.id));
    }

    async function send() {
      const message = input.value.trim();
      if (!message) return;
      input.value = '';
      add('user', message);
      const pending = addThinking();
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({ caseId: caseId || undefined, message, persona: personaSelect.value, async: true })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || '请求失败：HTTP ' + res.status);
        }
        caseId = json.caseId;
        localStorage.setItem('super-helper.caseId', caseId);
        setCaseHeader({ id: json.caseId, title: json.title, status: json.status, claudeSessionId: json.claudeSessionId || '', userPersona: json.persona, contextUsage: json.contextUsage });
        await loadSessions();
        await pollSessionUntilSettled(pending, json.caseId, json.userMessageId);
      } catch (error) {
        pending.classList.remove('thinking', 'progress');
        pending.classList.add('error');
        pending.textContent = '请求中断了，我没有继续假装思考。\\n\\n原因：' + errorMessage(error) + '\\n\\n你可以打开“查看诊断日志”看详细链路，或直接重试。';
      }
    }

    async function pollSessionUntilSettled(pending, pollingCaseId, userMessageId) {
      let lastStatusText = '';
      while (true) {
        const sessionRes = await fetch(lightweightSessionUrl(pollingCaseId));
        const sessionJson = await sessionRes.json();
        if (!sessionRes.ok) {
          throw new Error(sessionJson.error || 'session load failed');
        }
        const session = sessionJson.session;
        if (pollingCaseId === caseId) {
          setCaseHeader(session);
        }
        const latestStatus = renderProgressActivity(session);
        if (latestStatus && latestStatus !== lastStatusText) {
          lastStatusText = latestStatus;
          pending.innerHTML = latestStatus;
        }
        const latestHelper = [...(session.messages || [])].reverse().find((message) => message.role === 'helper' && (!userMessageId || message.replyToMessageId === userMessageId));
        const finished = !['diagnosing', 'ready_for_diagnosis'].includes(session.status) && latestHelper;
        if (finished) {
          pending.classList.remove('thinking', 'progress');
          pending.textContent = '';
          await typeWriter(
            pending,
            latestHelper.body || '本轮没有返回内容，请查看诊断日志。',
            findRunResultForMessage(session, latestHelper),
          );
          loadSessionsInBackground();
          refreshCurrentKnowledgeHealth(session).catch(() => {});
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }

    function renderProgressActivity(session) {
      const profile = progressProfile(session?.userPersona || personaSelect.value);
      const activity = session?.agentActivity || [];
      const activeRun = latestActiveRun(session?.runs || []);
      const percent = estimateProgressPercent(session || {});
      const activeIndex = progressStepIndex(profile.steps.length, percent);
      const copy = progressActivityCopy(profile, activeIndex, activity, session?.status, activeRun);
      const steps = profile.steps.map((step, index) => {
        const state = index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'pending';
        return '<span class="progress-step ' + state + '">' + escapeHtml(step) + '</span>';
      }).join('');
      const detail = profile.mode === 'technical'
        ? renderTechnicalProgressDetail(activity)
        : renderPlainProgressDetail(profile, activeIndex);
      return '<div class="progress-card progress-' + escapeHtml(profile.mode) + ' is-active" role="status" aria-live="polite" aria-label="' + escapeHtml(copy.title + '，' + copy.summary + '，进度 ' + percent + '%') + '">'
        + '<div class="progress-card-head"><span class="progress-title"><strong><span class="progress-live-dot" aria-hidden="true"></span><span class="progress-title-text">' + escapeHtml(copy.title) + '</span></strong><span class="progress-summary">' + escapeHtml(copy.summary) + '</span></span><span class="progress-meter"><span class="progress-running"><span class="progress-running-dot" aria-hidden="true"></span>运行中</span><span class="progress-percent">' + percent + '%</span></span></div>'
        + '<span class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '"><span class="progress-bar" style="width: ' + percent + '%"></span></span>'
        + '<div class="progress-steps">' + steps + '</div>'
        + detail
        + '<div class="progress-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>'
        + '<div class="progress-actions"><button type="button" onclick="noopWait()">继续等待</button><button type="button" onclick="openTicketDraft()">升级工单</button></div>'
        + '</div>';
    }

    function progressActivityCopy(profile, activeIndex, activity, status, activeRun) {
      const current = profile.steps[Math.min(profile.steps.length - 1, Math.max(0, activeIndex))];
      const fallbackTitle = status === 'ready_for_diagnosis' ? '正在进入诊断队列' : '正在推进' + current;
      const fallback = {
        title: fallbackTitle,
        summary: profile.summary
      };
      const latest = latestProgressActivity(activity);
      if (activeRun?.status === 'queued') {
        return { title: '正在排队等待只读诊断', summary: '已接收问题，正在等待诊断任务开始执行。' };
      }
      if (activeRun?.status === 'running') {
        return { title: '正在运行只读代码排查', summary: '诊断工具正在读取项目文件，并准备结构化证据。' };
      }
      if (!latest) {
        return fallback;
      }
      const phase = String(latest.phase || '');
      const agentId = String(latest.agentId || '');
      const latestSummary = normalizeProgressSummary(latest.summary || fallback.summary);
      if (/input_received|persona_agent_result/.test(phase)) {
        return { title: '正在整理你的问题', summary: '会提取业务对象、症状和本轮未知项。' };
      }
      if (/experience/.test(phase) || agentId === 'experience') {
        return { title: '正在核对同案上下文', summary: '会确认是否有可安全复用的历史答案。' };
      }
      if (/input_review|preflight|local_preflight|model_preflight/.test(phase) || agentId === 'input-review') {
        return { title: '正在判断是否需要追问', summary: '会检查现有信息是否足够进入只读诊断。' };
      }
      if (/knowledge_router/.test(phase) || agentId === 'knowledge-router') {
        return { title: '正在识别知识路径', summary: '会把问题归一化为模块、意图和关键词。' };
      }
      if (/evidence_judge|knowledge_answer|code_escalation|deep_query/.test(phase) || agentId === 'evidence-judge') {
        return { title: '正在判断证据是否足够', summary: '会决定直接回答、继续检索，还是升级代码排查。' };
      }
      if (/diagnostic_request|follow_up_diagnostic/.test(phase)) {
        return { title: '正在准备只读诊断请求', summary: '会整理已知事实、未知项和排查约束。' };
      }
      if (/review/.test(phase) || agentId === 'output-review') {
        return { title: '正在审核证据和结论', summary: '会检查每个结论是否有证据支撑。' };
      }
      if (/presentation|user_reply/.test(phase) || agentId === 'presentation') {
        return { title: '正在整理可执行答复', summary: '会按当前用户视角组织结论、证据和下一步。' };
      }
      const label = String(latest.label || latest.phase || current || '').trim();
      return {
        title: label ? '正在处理：' + label : fallback.title,
        summary: latestSummary
      };
    }

    function latestProgressActivity(activity) {
      return (activity || []).find((item) => item && (item.phase || item.label || item.summary)) || null;
    }

    function latestActiveRun(runs) {
      return [...(runs || [])].reverse().find((run) => ['queued', 'running'].includes(run.status)) || null;
    }

    function normalizeProgressSummary(summary) {
      return String(summary || '')
        .replace(/Preflight Gate/g, '预检')
        .replace(/Claude Code/g, '只读诊断工具')
        .replace(/DiagnosticRequest/g, '诊断请求')
        .replace(/agent/gi, 'Agent');
    }

    function progressProfile(persona) {
      const profiles = {
        operations: {
          mode: 'plain',
          title: '正在梳理业务处理方案',
          summary: '我会先核对上下文，再整理可以直接执行的建议。',
          closing: '完成后会给出操作步骤、补数据口径和注意点。',
          steps: ['理解问题', '知识路由', '检索证据', '证据判断', '生成答复']
        },
        customer: {
          mode: 'plain',
          title: '正在确认问题状态',
          summary: '我会把进展保持在容易理解的步骤里。',
          closing: '完成后会用清楚的话说明原因和下一步。',
          steps: ['理解问题', '知识路由', '检索证据', '证据判断', '生成答复']
        },
        support: {
          mode: 'technical',
          title: '正在推进支持诊断',
          summary: '同步展示 Agent 阶段和可追踪线索，方便后续接手。',
          steps: ['理解问题', '知识路由', '检索证据', '证据判断', '生成答复']
        },
        developer: {
          mode: 'technical',
          title: '正在运行技术诊断',
          summary: '保留 Preflight、Claude Code 和输出审核阶段。',
          steps: ['理解问题', '知识路由', '检索证据', '代码排查', '生成答复']
        }
      };
      return profiles[persona] || profiles.operations;
    }

    function estimateProgressPercent(session) {
      const activity = session?.agentActivity || [];
      const status = session?.status || '';
      const haystack = activity.map((item) => [item.agentName, item.agentId, item.label, item.phase, item.summary].filter(Boolean).join(' ')).join(' ');
      let percent = activity.length ? 18 + Math.min(activity.length, 5) * 10 : 10;
      if (status === 'ready_for_diagnosis') percent = Math.max(percent, 22);
      if (/预检|Preflight/i.test(haystack)) percent = Math.max(percent, 30);
      if (/经验|上下文|context|knowledge/i.test(haystack)) percent = Math.max(percent, 44);
      if (/Claude|诊断|Diagnostic|diagnos/i.test(haystack) || status === 'diagnosing') percent = Math.max(percent, 58);
      if (/审核|输出|review|presentation|answer|答案/i.test(haystack)) percent = Math.max(percent, 76);
      return Math.min(92, percent);
    }

    function progressStepIndex(totalSteps, percent) {
      return Math.min(totalSteps - 1, Math.max(0, Math.floor(percent / (100 / totalSteps))));
    }

    function renderPlainProgressDetail(profile, activeIndex) {
      const current = profile.steps[Math.min(profile.steps.length - 1, activeIndex)];
      return '<span class="progress-note">当前阶段：' + escapeHtml(current) + '。' + escapeHtml(profile.closing) + '</span>';
    }

    function renderTechnicalProgressDetail(activity) {
      const steps = (activity || []).slice(0, 5);
      if (!steps.length) {
        return '<span class="progress-technical"><span><strong>输入审核</strong> 等待阶段信息返回</span></span>';
      }
      return '<span class="progress-technical">' + steps.map((item) => '<span><strong>' + escapeHtml(item.agentName || item.agentId || 'Agent') + '</strong> ' + escapeHtml(item.label || item.phase || '处理中') + '：' + escapeHtml(item.summary || '') + '</span>').join('') + '</span>';
    }

    function renderAgentActivity(activity) {
      const steps = (activity || []).slice(0, 5);
      if (!steps.length) {
        return '<span class="activity-trace"><span class="activity-step"><strong>主 Agent</strong> 正在接收问题...</span></span>';
      }
      return '<span class="activity-trace">' + steps.map((item) => '<span class="activity-step"><strong>' + escapeHtml(item.agentName || item.agentId || 'Agent') + '</strong> ' + escapeHtml(item.label || item.phase) + '：' + escapeHtml(item.summary || '') + '</span>').join('') + '</span>';
    }

    async function latestLogSummary() {
      if (!caseId) return '';
      try {
        const res = await fetch('/api/logs?caseId=' + encodeURIComponent(caseId));
        const json = await res.json();
        if (!res.ok || !json.blocks?.length) return '';
        const block = json.blocks[0];
        return block.label + '：' + block.summary;
      } catch {
        return '';
      }
    }

    async function typeWriter(element, text, result) {
      element.classList.remove('thinking', 'progress');
      element.classList.add('helper');
      const chars = Array.from(text);
      for (let index = 1; index <= chars.length; index += Math.max(1, Math.ceil(chars.length / 160))) {
        element.innerHTML = renderRichText(chars.slice(0, index).join(''));
        chat.scrollTop = chat.scrollHeight;
        await new Promise((resolve) => setTimeout(resolve, 14));
      }
      element.innerHTML = renderHelperMessage(text, result);
    }

    async function openLogs() {
      document.getElementById('drawer').classList.add('open');
      await refreshLogs();
    }

    async function refreshLogs() {
      const logs = document.getElementById('logs');
      if (!caseId) {
        logs.innerHTML = '<div class="log">还没有诊断日志。</div>';
        return;
      }
      const res = await fetch('/api/logs?caseId=' + encodeURIComponent(caseId));
      const json = await res.json();
      if (res.ok) {
        renderLogs(json);
      } else {
        logs.innerHTML = '<div class="log-block error"><div class="log-detail">日志读取失败：' + escapeHtml(json.error || 'unknown error') + '</div></div>';
      }
    }

    function renderLogs(json) {
      const logs = document.getElementById('logs');
      const blocks = json.blocks || [];
      logs.innerHTML = blocks.length
        ? blocks.map((block, index) => renderLogBlock(block, index < 6)).join('')
        : '<div class="log">还没有诊断日志。</div>';
    }

    function renderLogBlock(block, open) {
      const detail = block.detail === undefined ? '' : JSON.stringify(block.detail, null, 2);
      const command = block.command ? '<div class="log-command"><strong>Claude Code 命令</strong>\\n' + escapeHtml(block.command) + '</div>' : '';
      const tags = (block.tags || []).map((tag) => '<span class="log-label">' + escapeHtml(tag) + '</span>').join('');
      return '<details class="log-block ' + escapeHtml(block.severity || 'info') + '"' + (open ? ' open' : '') + '>'
        + '<summary><div class="log-title"><span>' + escapeHtml(block.label || '执行过程') + ' - ' + escapeHtml(block.title || block.summary || '') + '</span><span class="log-label">' + escapeHtml(block.severity || 'info') + '</span></div>'
        + '<div class="log-meta">' + escapeHtml(block.createdAt || '') + ' / ' + escapeHtml(block.agentName || block.actor || '') + ' / ' + escapeHtml(block.phase || '') + '</div>'
        + '<div>' + tags + '</div></summary>'
        + command
        + '<div class="log-detail">' + escapeHtml(detail || block.summary || '') + '</div></details>';
    }

    async function openSettings() {
      document.getElementById('settingsDrawer').classList.add('open');
      await loadSettings();
    }

    function closeSettings() { document.getElementById('settingsDrawer').classList.remove('open'); }

    function readSettingsForm(includeKey) {
      const apiKey = document.getElementById('apiKey').value.trim();
      return {
        providerId: document.getElementById('providerId').value.trim() || 'default',
        baseUrl: document.getElementById('baseUrl').value.trim(),
        api: document.getElementById('apiType').value,
        apiKeyEnv: document.getElementById('apiKeyEnv').value.trim(),
        apiKey: includeKey && apiKey ? apiKey : undefined,
        model: document.getElementById('modelId').value.trim(),
        maxTokens: Number(document.getElementById('maxTokens').value || 1200),
        contextWindowTokens: Number(document.getElementById('contextWindowTokens').value || 200000),
        temperature: Number(document.getElementById('temperature').value || 0),
        useModelForPreflight: true
      };
    }

    function readEmbeddingForm(includeKey) {
      const apiKey = document.getElementById('embeddingApiKey').value.trim();
      return {
        enabled: document.getElementById('embeddingEnabled').checked,
        provider: document.getElementById('embeddingProvider').value.trim() || 'siliconflow',
        model: document.getElementById('embeddingModel').value.trim(),
        baseUrl: document.getElementById('embeddingBaseUrl').value.trim(),
        apiKeyEnv: document.getElementById('embeddingApiKeyEnv').value.trim(),
        apiKey: includeKey && apiKey ? apiKey : undefined,
        dimensions: Number(document.getElementById('embeddingDimensions').value || 1024),
        distance: 'cosine'
      };
    }

    function readRerankForm(includeKey) {
      const apiKey = document.getElementById('rerankApiKey').value.trim();
      return {
        enabled: document.getElementById('rerankEnabled').checked,
        provider: document.getElementById('rerankProvider').value.trim() || 'siliconflow',
        model: document.getElementById('rerankModel').value.trim(),
        baseUrl: document.getElementById('rerankBaseUrl').value.trim(),
        apiKeyEnv: document.getElementById('rerankApiKeyEnv').value.trim(),
        apiKey: includeKey && apiKey ? apiKey : undefined,
        topN: Number(document.getElementById('rerankTopN').value || 8)
      };
    }

    async function testModel() {
      const status = document.getElementById('settingsStatus');
      status.textContent = '正在测试模型...';
      const res = await fetch('/api/settings/model/test', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(readSettingsForm(true))
      });
      const json = await res.json();
      status.textContent = json.ok
        ? '模型连接成功：' + json.model + '\\n返回：' + json.reply
        : '模型连接失败：' + json.error;
    }

    async function testEmbedding() {
      const status = document.getElementById('settingsStatus');
      status.textContent = '正在测试 Embedding...';
      const payload = readEmbeddingForm(true);
      payload.enabled = true;
      const res = await fetch('/api/settings/embedding/test', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      status.textContent = json.ok
        ? 'Embedding 连接成功：' + json.model + ' · ' + json.dimensions + ' 维'
        : 'Embedding 连接失败：' + (json.error ? json.error.safeMessage : 'unknown');
    }

    async function testRerank() {
      const status = document.getElementById('settingsStatus');
      status.textContent = '正在测试 Rerank...';
      const payload = readRerankForm(true);
      payload.enabled = true;
      const res = await fetch('/api/settings/rerank/test', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      status.textContent = json.ok
        ? 'Rerank 连接成功：' + json.model + ' · top score ' + json.topScore
        : 'Rerank 连接失败：' + (json.error ? json.error.safeMessage : 'unknown');
    }

    async function saveSettings() {
      const status = document.getElementById('settingsStatus');
      status.textContent = '正在保存配置...';
      const res = await fetch('/api/settings/model', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(readSettingsForm(true))
      });
      const modelJson = await res.json();
      const embeddingRes = await fetch('/api/settings/embedding', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(readEmbeddingForm(true))
      });
      const embeddingJson = await embeddingRes.json();
      const rerankRes = await fetch('/api/settings/rerank', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(readRerankForm(true))
      });
      const rerankJson = await rerankRes.json();
      const claudeRes = await fetch('/api/settings/claude', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          timeoutMs: Number(document.getElementById('claudeTimeoutMs').value || 1200000),
          maxBudgetUsd: optionalNumberInput('claudeMaxBudgetUsd'),
          sessionBusyMaxRetries: Number(document.getElementById('sessionBusyMaxRetries').value || 3),
          sessionBusyRetryDelayMs: Number(document.getElementById('sessionBusyRetryDelayMs').value || 3000)
        })
      });
      const claudeJson = await claudeRes.json();
      status.textContent = modelJson.agent && embeddingJson.embedding && rerankJson.rerank && claudeJson.claude ? '配置已保存。' : '保存失败：' + JSON.stringify({modelJson, embeddingJson, rerankJson, claudeJson});
      document.getElementById('apiKey').value = '';
      document.getElementById('embeddingApiKey').value = '';
      document.getElementById('rerankApiKey').value = '';
      await loadConfig();
    }

    function optionalNumberInput(id) {
      const value = document.getElementById(id).value.trim();
      return value ? Number(value) : null;
    }

    function closeLogs() {
      document.getElementById('drawer').classList.remove('open');
    }
    async function newCase() {
      const res = await fetch('/api/sessions?includeKnowledgeHealth=false', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ title: '新对话', persona: personaSelect.value })
      });
      const json = await res.json();
      caseId = json.session.id;
      localStorage.setItem('super-helper.caseId', caseId);
      markActiveSession(caseId);
      chat.innerHTML = '';
      setCaseHeader(json.session);
      showEmptyChat();
      loadSessionsInBackground();
      refreshCurrentKnowledgeHealth(json.session).catch(() => {});
    }
    function lightweightSessionUrl(id) {
      return '/api/session?caseId=' + encodeURIComponent(id) + '&includeKnowledgeHealth=false';
    }
    function errorMessage(error) {
      return error instanceof Error ? error.message : String(error);
    }
    function personaLabel(persona) {
      return ({operations: '运营人员', support: '技术支持', customer: '客户', developer: '开发人员'})[persona] || '运营人员';
    }
    function statusLabel(status, session) {
      if (session?.archivedAt || status === 'archived') return '已归档';
      return ({
        collecting_input: '新建',
        ready_for_diagnosis: '等待诊断',
        diagnosing: '诊断中',
        need_input: '待补充',
        partial: '证据不足',
        concluded: '已有结论'
      })[status] || '新建';
    }
    function normalizeStatusClass(status) {
      return String(status || 'collecting_input').replace(/[^a-z0-9_-]/gi, '_');
    }
    function statusProgressPercent(session) {
      const status = session?.status || 'collecting_input';
      if (status === 'concluded') return 100;
      if (status === 'partial' || status === 'need_input') return 80;
      if (status === 'diagnosing' || status === 'ready_for_diagnosis') return estimateProgressPercent(session || {});
      return 8;
    }
    function renderCaseStepRail(session) {
      const rail = document.getElementById('caseStepRail');
      const steps = ['理解问题', '知识路由', '检索证据', '证据判断', '生成答复'];
      const percent = statusProgressPercent(session);
      const activeIndex = progressStepIndex(steps.length, percent);
      rail.innerHTML = steps.map((step, index) => {
        const state = index < activeIndex || percent === 100 ? 'done' : index === activeIndex ? 'current' : 'pending';
        return '<span class="case-step ' + state + '">' + escapeHtml(step) + '</span>';
      }).join('');
    }
    function setSessionFilter(filter) {
      sessionFilter = filter;
      ['all', 'active', 'concluded', 'need_input'].forEach((item) => {
        const button = document.getElementById('sessionFilter-' + item);
        if (button) button.classList.toggle('active', item === filter);
      });
      loadSessions();
    }
    function setInsightTab(tab) {
      activeInsightTab = tab;
      ['progress', 'evidence', 'health'].forEach((item) => {
        const button = document.getElementById('insightTab-' + item);
        if (button) button.classList.toggle('active', item === tab);
      });
      updateInsightPanel(currentSession);
    }
    function updateInsightPanel(session) {
      const content = document.getElementById('insightContent');
      const subhead = document.getElementById('insightSubhead');
      if (!content) return;
      subhead.textContent = session?.id ? statusLabel(session.status, session) + ' / ' + personaLabel(session.userPersona || personaSelect.value) : '知识健康与证据路线';
      if (activeInsightTab === 'evidence') {
        content.innerHTML = renderInsightEvidence(session);
      } else if (activeInsightTab === 'health') {
        content.innerHTML = renderInsightKnowledgeHealth(session);
      } else {
        content.innerHTML = renderInsightProgress(session);
      }
    }
    function renderInsightProgress(session) {
      const percent = statusProgressPercent(session);
      const activity = (session?.agentActivity || []).slice(0, 4);
      const statusText = session?.id ? statusLabel(session.status, session) : '等待输入';
      const ticket = ticketDraftNotice
        ? '<div class="insight-card placeholder-note"><strong>占位动作</strong><p>' + escapeHtml(ticketDraftNotice) + '</p></div>'
        : '';
      const activityHtml = activity.length
        ? '<div class="trace-map">' + activity.map((item) => '<div class="trace-node active"><strong>' + escapeHtml(item.agentName || item.agentId || 'Agent') + '</strong><span>' + escapeHtml(item.label || item.phase || '处理中') + '：' + escapeHtml(item.summary || '') + '</span></div>').join('') + '</div>'
        : '<div class="trace-map"><div class="trace-node"><strong>等待诊断</strong><span>发送问题后，这里会显示输入审核、经验复用、诊断和输出审核。</span></div></div>';
      return ticket
        + '<div class="insight-card"><strong>本轮状态</strong><p>' + escapeHtml(statusText) + '</p><span class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '"><span class="progress-bar" style="width: ' + percent + '%"></span></span><span class="insight-meta">' + percent + '%</span></div>'
        + '<div class="insight-card"><strong>查询路线</strong><div class="trace-map"><div class="trace-node active"><strong>理解问题</strong><span>从对话中提取业务对象、症状和未知项。</span></div><div class="trace-node"><strong>知识路由</strong><span>后续接入 taxonomy 后，会展示模块、意图和别名命中。</span></div><div class="trace-node"><strong>检索证据</strong><span>在 FAQ、Runbook、已解决 Case 和白皮书切片中收集证据。</span></div><div class="trace-node"><strong>证据判断</strong><span>Evidence Judge 会判断是否足够回答，或是否需要代码排查和升级工单。</span></div></div></div>'
        + '<div class="insight-card"><strong>最近 Agent 活动</strong>' + activityHtml + '</div>';
    }
    function renderInsightEvidence(session) {
      const run = latestRunWithResult(session);
      const evidence = run?.result?.evidence || [];
      const claims = (run?.result?.claims || []).filter((claim) => ['fact', 'inference'].includes(claim.type) && (claim.evidenceIds || []).length);
      const missing = run?.result?.missingInfo || [];
      const claimRows = claims.length
        ? claims.slice(0, 6).map((claim) => '<div class="evidence-row"><strong>' + escapeHtml(claim.type || 'claim') + '</strong><span>' + escapeHtml(claim.text || '') + '</span></div>').join('')
        : '<div class="evidence-row placeholder-note"><strong>暂无已支持判断</strong><span>当前结果还没有通过审核的事实或推断。</span></div>';
      const rows = evidence.length
        ? evidence.slice(0, 6).map((item) => '<div class="evidence-row"><strong>' + escapeHtml(item.kind || 'evidence') + ' / ' + escapeHtml(item.confidence || 'unknown') + '</strong><span>' + escapeHtml(item.summary || '') + '</span><span>' + escapeHtml(item.source || '') + '</span></div>').join('')
        : '<div class="evidence-row placeholder-note"><strong>暂无结构化证据</strong><span>当前后端还没有把知识库 evidence pack 接入主聊天路径。现有证据会优先在诊断日志和最终回答里出现。</span></div>';
      const missingHtml = missing.length
        ? '<div class="insight-card"><strong>未知项</strong>' + missing.slice(0, 5).map((item) => '<p>' + escapeHtml(item) + '</p>').join('') + '</div>'
        : '';
      return '<div class="insight-card"><strong>已支持判断</strong><p>先看通过审核的事实或推断，再查看下方证据来源。</p></div>'
        + claimRows
        + '<div class="insight-card"><strong>证据列表</strong><p>这里展示当前 case 已返回的结构化 evidence。后续知识库接入后，会显示 FAQ、runbook、solved case 和白皮书切片。</p></div>'
        + rows
        + missingHtml;
    }
    function renderInsightKnowledgeHealth(session) {
      const health = session?.knowledgeHealth;
      if (!health) {
        return '<div class="tree-card"><strong>知识健康</strong><p>打开具体会话后，会检查当前服务绑定、索引、检索和 Embedding 状态。</p></div>'
          + '<div class="knowledge-health-grid">'
          + renderHealthTile('服务绑定', '待检查', 'off')
          + renderHealthTile('索引状态', '待检查', 'off')
          + renderHealthTile('检索命中', '待检查', 'off')
          + renderHealthTile('Embedding', '未启用', 'off')
          + '</div>';
      }

      const service = health.serviceBinding || {};
      const index = health.index || {};
      const search = health.search || {};
      const embedding = health.embedding || {};
      const similar = health.similarWorkspaces || [];
      const alert = service.status === 'error'
        ? '<div class="health-alert"><strong>' + escapeHtml(service.message || '当前服务没有对应知识库目录') + '</strong><span>' + escapeHtml(service.workspaceRoot || '') + '</span><code class="health-code">' + escapeHtml(service.workspaceKey || '') + '</code></div>'
        : '<div class="insight-card"><strong>服务绑定</strong><p>' + escapeHtml(service.message || '当前服务已绑定知识库工作区') + '</p><code class="health-code">' + escapeHtml(service.workspaceKey || '') + '</code></div>';
      const treeNodes = [
        renderHealthNode('Current Service: ' + (service.workspaceId || 'current'), service.workspaceRoot || '未识别服务路径', service.status),
        renderHealthNode('knowledge root', service.knowledgeRoot || '未解析知识库路径', service.status),
        renderHealthNode('manifest.json', index.manifestExists ? (index.documentCount + ' docs · ' + (index.updatedAt || '未记录更新时间')) : '缺失', index.manifestExists ? index.status : 'error'),
        renderHealthNode('chunks.jsonl', index.chunksExists ? (index.chunkCount + ' chunks') : '缺失', index.chunksExists ? index.status : 'error'),
      ].join('');
      const similarHtml = similar.length
        ? similar.map((item) => renderHealthNode('发现相似知识库', item.key + ' · ' + item.documentCount + ' docs · ' + item.chunkCount + ' chunks', 'ok')).join('')
        : renderHealthNode('发现相似知识库', '暂无可建议绑定的其他知识库', 'off');
      const filtered = (search.filteredOut || []).length
        ? (search.filteredOut || []).map((item) => item.reason + ':' + item.count).join(' / ')
        : '0';
      const actions = (health.actions || ['绑定知识库', '重建索引', '运行健康检查']).map((action) =>
        '<button type="button" onclick="healthAction(\\'' + escapeHtml(action) + '\\')">' + escapeHtml(action) + '</button>'
      ).join('');
      const notice = knowledgeActionNotice
        ? '<div class="insight-card"><strong>知识库动作</strong><p>' + escapeHtml(knowledgeActionNotice) + '</p></div>'
        : '';

      return '<div class="knowledge-health-grid">'
        + renderHealthTile('服务绑定', healthStatusText(service.status), service.status)
        + renderHealthTile('索引状态', healthStatusText(index.status), index.status)
        + renderHealthTile('检索命中', (search.matchedFiles || 0) + ' / ' + (search.searchedFiles || 0), search.status)
        + renderHealthTile('Embedding', healthStatusText(embedding.status), embedding.status)
        + '</div>'
        + alert
        + '<div class="tree-card"><strong>知识树路径</strong><p>按当前服务绑定展开，只显示本轮诊断有关的健康节点。</p></div>'
        + '<div class="health-tree">' + treeNodes + similarHtml + '</div>'
        + '<div class="insight-card"><strong>本轮检索路径</strong><p><b>Query：</b>' + escapeHtml(search.query || session?.title || '暂无查询') + '</p><div class="health-row"><span><b>searched_files</b> ' + escapeHtml(String(search.searchedFiles || 0)) + '</span><span><b>matched_files</b> ' + escapeHtml(String(search.matchedFiles || 0)) + '</span><span><b>filtered_out</b> ' + escapeHtml(filtered) + '</span><span><b>reason</b> ' + escapeHtml(search.reason || '暂无检索结果') + '</span></div></div>'
        + '<div class="insight-card"><strong>Embedding</strong><p>' + escapeHtml(embedding.message || 'Embedding 未启用') + '</p></div>'
        + notice
        + '<div class="health-actions">' + actions + '</div>';
    }
    function latestRunWithResult(session) {
      return [...(session?.runs || [])].reverse().find((run) => run.result);
    }
    function inferKnowledgeModule(session) {
      const text = [session?.title, ...(session?.messages || []).slice(-3).map((message) => message.body)].filter(Boolean).join(' ');
      if (/学员|学习|统计|learn/i.test(text)) return '学员管理';
      if (/课程|course/i.test(text)) return '课程管理';
      if (/订单|支付|order|pay/i.test(text)) return '订单支付';
      if (/权限|安全|permission|security/i.test(text)) return '权限安全';
      return '当前业务模块';
    }
    function renderHealthTile(label, value, status) {
      return '<div class="health-tile ' + healthStatusClass(status) + '"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value || '未知') + '</strong></div>';
    }
    function renderHealthNode(title, detail, status) {
      return '<div class="health-node ' + healthStatusClass(status) + '"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(detail || '暂无数据') + '</span></div>';
    }
    function healthStatusClass(status) {
      if (status === 'ok' || status === 'warn' || status === 'error' || status === 'off') return status;
      return 'off';
    }
    function healthStatusText(status) {
      if (status === 'ok') return '正常';
      if (status === 'warn') return '需关注';
      if (status === 'error') return '异常';
      return '未启用';
    }
    function knowledgeHeaderLabel(health) {
      if (!health) return '知识库待检查';
      if (health.serviceBinding?.status === 'error') return '知识库未连接';
      if (health.index?.status === 'error') return '索引缺失';
      if (health.index?.status === 'warn') return '索引需重建';
      if (health.search?.status === 'warn') return '知识未命中';
      return '知识库正常';
    }
    async function refreshCurrentKnowledgeHealth(session) {
      if (!session?.id || !session.workspaceId) {
        return;
      }
      const targetCaseId = session.id;
      const workspaceId = session.workspaceId;
      const query = latestUserQuery(session) || session.title || '';
      const res = await fetch('/api/knowledge/health?workspaceId=' + encodeURIComponent(workspaceId) + '&query=' + encodeURIComponent(query));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || '请求失败：HTTP ' + res.status);
      }
      if (caseId !== targetCaseId || !json.knowledgeHealth) {
        return;
      }
      currentSession = { ...(currentSession || session), knowledgeHealth: json.knowledgeHealth };
      setCaseHeader(currentSession);
      updateInsightPanel(currentSession);
    }
    async function healthAction(action) {
      if (!currentSession?.workspaceId) {
        knowledgeActionNotice = '请先打开一个会话，再检查或绑定当前服务的知识库。';
        activeInsightTab = 'health';
        setInsightTab('health');
        return;
      }

      const workspaceId = currentSession.workspaceId;
      const query = latestUserQuery(currentSession) || currentSession.title || '';
      knowledgeActionNotice = action + '进行中...';
      activeInsightTab = 'health';
      setInsightTab('health');

      try {
        let res;
        if (action === '绑定知识库') {
          res = await fetch('/api/knowledge/bind', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({ workspaceId, query })
          });
        } else if (action === '重建索引') {
          res = await fetch('/api/knowledge/reindex', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({ workspaceId, query })
          });
        } else {
          res = await fetch('/api/knowledge/health?workspaceId=' + encodeURIComponent(workspaceId) + '&query=' + encodeURIComponent(query));
        }

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || '请求失败：HTTP ' + res.status);
        }

        if (json.knowledgeHealth) {
          currentSession = { ...currentSession, knowledgeHealth: json.knowledgeHealth };
          setCaseHeader(currentSession);
        }
        knowledgeActionNotice = action + '完成：' + (json.knowledgeHealth?.serviceBinding?.message || '已刷新知识健康状态');
        updateInsightPanel(currentSession);
        await loadSessions();
      } catch (error) {
        knowledgeActionNotice = action + '失败：' + errorMessage(error);
        updateInsightPanel(currentSession);
      }
    }
    function latestUserQuery(session) {
      return [...(session?.messages || [])].reverse().find((message) => message.role === 'user')?.body || '';
    }
    function openTicketDraft() {
      ticketDraftNotice = caseId
        ? '工单系统预留：后续会携带 caseId、当前状态、证据摘要、未知项和用户最后一句话创建工单。'
        : '工单系统预留：新建诊断后，可从当前 case 直接升级工单。';
      activeInsightTab = 'progress';
      setInsightTab('progress');
    }
    function markResolvedPlaceholder() {
      ticketDraftNotice = '已解决确认预留：后续会触发 Case Curator，生成 solved case 草稿并标记 review_required。';
      activeInsightTab = 'health';
      setInsightTab('health');
    }
    function openAccountPlaceholder() {
      ticketDraftNotice = '用户系统预留：这里未来会放头像、账号、团队、偏好设置和退出登录。';
      activeInsightTab = 'progress';
      setInsightTab('progress');
    }
    function noopWait() {
      ticketDraftNotice = '已继续等待，本轮诊断仍在后台推进。';
      activeInsightTab = 'progress';
      setInsightTab('progress');
    }
    function renderHelperMessage(text, result) {
      const split = splitLegacyEvidenceSections(text);
      const bodyHtml = '<div class="answer-body">' + renderRichText(split.body || text) + '</div>';
      return bodyHtml + renderAnswerEvidence(result, split);
    }
    function renderAnswerEvidence(result, legacy) {
      const claims = (result?.claims || [])
        .filter((claim) => ['fact', 'inference'].includes(claim.type) && (claim.evidenceIds || []).length)
        .map((claim) => claim.text);
      const evidence = (result?.evidence || [])
        .filter((item) => item.confidence !== 'low')
        .map((item) => ({
          summary: item.summary || '',
          source: item.source || '',
          confidence: item.confidence || 'unknown',
        }));
      const claimRows = (claims.length ? claims : legacy.claims).slice(0, 4);
      const evidenceRows = (evidence.length ? evidence : legacy.evidence).slice(0, 3);
      const count = claimRows.length + evidenceRows.length;
      if (!count) return '';
      const claimsHtml = claimRows.length
        ? '<div class="answer-evidence-group"><strong class="answer-section-title">已支持判断</strong>' + claimRows.map((claim, index) => '<div class="answer-evidence-row"><b>' + (index + 1) + '. ' + escapeHtml(claim) + '</b></div>').join('') + '</div>'
        : '';
      const evidenceHtml = evidenceRows.length
        ? '<div class="answer-evidence-group"><strong class="answer-section-title">关键证据</strong>' + evidenceRows.map((item, index) => '<div class="answer-evidence-row"><b>' + (index + 1) + '. ' + escapeHtml(item.summary) + '</b><span>' + escapeHtml(item.source ? item.source + ' · 可信度：' + item.confidence : '可信度：' + item.confidence) + '</span></div>').join('') + '</div>'
        : '';
      return '<details class="answer-evidence"><summary>查看关键证据（' + count + '）</summary><div class="answer-evidence-body">' + claimsHtml + evidenceHtml + '</div></details>';
    }
    function splitLegacyEvidenceSections(text) {
      const raw = String(text || '');
      const supportIndex = raw.search(/\\n支撑证据：|^支撑证据：/m);
      const supportedIndex = raw.search(/\\n已支持判断：|^已支持判断：/m);
      const firstIndex = [supportIndex, supportedIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0];
      const body = firstIndex >= 0 ? raw.slice(0, firstIndex).trim() : raw;
      const supportText = supportIndex >= 0
        ? raw.slice(supportIndex, supportedIndex > supportIndex ? supportedIndex : raw.length)
        : '';
      const supportedText = supportedIndex >= 0
        ? raw.slice(supportedIndex, supportIndex > supportedIndex ? supportIndex : raw.length)
        : '';
      return {
        body,
        claims: extractNumberedLines(supportedText.replace(/已支持判断：/, '')),
        evidence: extractNumberedLines(supportText.replace(/支撑证据：/, '')).map((line) => ({
          summary: line.replace(/（来源：[\\s\\S]*$/, '').trim(),
          source: (line.match(/来源：([^，）]+)/)?.[1] || '').trim(),
          confidence: (line.match(/可信度：([^）]+)/)?.[1] || 'unknown').trim(),
        })),
      };
    }
    function extractNumberedLines(text) {
      return String(text || '')
        .split(/\\n+/)
        .map((line) => line.trim().replace(/^\\d+\\.\\s*/, '').replace(/^[-*]\\s*/, ''))
        .filter(Boolean);
    }
    function findRunResultForMessage(session, message) {
      if (!session || !message?.replyToMessageId) return latestRunWithResult(session)?.result;
      const matched = [...(session.runs || [])].reverse().find((run) =>
        run.result && run.request?.context?.resolvedTurn?.latestUserMessageId === message.replyToMessageId
      );
      return matched?.result || latestRunWithResult(session)?.result;
    }
    function renderRichText(text) {
      const preBlocks = [];
      const tokenized = String(text).replace(/<pre>\\n?([\\s\\S]*?)\\n?<\\/pre>/g, (_match, raw) => {
        const token = '%%PRE_BLOCK_' + preBlocks.length + '%%';
        preBlocks.push('<pre>' + escapeHtml(raw) + '</pre>');
        return token;
      });
      let html = escapeHtml(tokenized)
        .replace(/^###\\s+(.+)$/gm, '<h3>$1</h3>')
        .replace(/^##\\s+(.+)$/gm, '<h2>$1</h2>')
        .replace(/^#\\s+(.+)$/gm, '<h1>$1</h1>')
        .replace(/\\*\\*(.+?)\\*\\*/g, '<strong class="answer-emphasis">$1</strong>')
        .replace(new RegExp('\\\\x60([^\\\\x60]+)\\\\x60', 'g'), '<code>$1</code>')
        .replace(/^(?:-|\\*)\\s+(.+)$/gm, '<li>$1</li>');
      html = html.replace(/(<li>[\\s\\S]*?<\\/li>)(?!(?:\\n?<li>))/g, '<ul>$1</ul>');
      html = html.replace(/\\n/g, '<br>');
      html = html.replace(/<\\/ul><br><ul>/g, '');
      preBlocks.forEach((block, index) => {
        html = html.replace('%%PRE_BLOCK_' + index + '%%', block);
      });
      return html;
    }
    function escapeHtml(text) {
      return String(text).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
    }
    document.addEventListener('click', (event) => {
      document.querySelectorAll('.session-menu.open').forEach((menu) => menu.classList.remove('open'));
      if (!event.target.closest?.('.case-more')) {
        document.querySelectorAll('.case-more[open]').forEach((menu) => menu.removeAttribute('open'));
      }
    });
    if (sessionSearch) {
      sessionSearch.addEventListener('input', () => loadSessions());
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        send();
      }
    });
    setCaseHeader();
    showEmptyChat();
    loadConfig();
    loadSessions().then(() => {
      if (caseId) {
        openSession(caseId).catch(() => {
          localStorage.removeItem('super-helper.caseId');
          caseId = '';
          setCaseHeader();
          showEmptyChat();
        });
      }
    });
  </script>
</body>
</html>`;
}
