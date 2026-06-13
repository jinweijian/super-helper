export function renderApp(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>supper helper</title>
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
    .sessions-sidebar { min-height: 0; border-right: 1px solid #d9e2ec; background: #ffffff; display: grid; grid-template-rows: auto 1fr; }
    .sessions-head { padding: 14px; border-bottom: 1px solid #edf1f5; display: grid; gap: 10px; }
    .sessions-head h2 { margin: 0; font-size: 14px; }
    .session-list { min-height: 0; overflow: auto; display: grid; align-content: start; gap: 6px; padding: 10px; }
    .session-item { min-height: 58px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px; align-items: stretch; border: 1px solid #cbd6e2; border-radius: 8px; background: #fff; overflow: visible; }
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
    .msg.helper strong { color: #1b6fd8; }
    .msg.helper mark { background: #fff2b8; color: #4d3800; padding: 0 3px; border-radius: 3px; }
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
      .session-list { grid-auto-flow: column; grid-auto-columns: minmax(210px, 260px); overflow-x: auto; overflow-y: hidden; padding: 8px 10px; }
      .session-item { min-height: 54px; }
    }
    @media (max-width: 700px) { main { padding: 12px 12px 0; } .case { display: grid; } .msg { max-width: 100%; } }
    @media (max-width: 520px) { .composer-actions { align-items: stretch; } .persona-control { flex: 1 1 auto; } #sendButton { align-self: flex-end; } }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <button class="brand-button" onclick="openSettings()" title="打开配置"><div class="mark">H</div><span>supper helper</span></button>
      <span class="pill" id="workspace">workspace loading...</span>
    </header>
    <div class="workspace-shell">
      <aside class="sessions-sidebar">
        <div class="sessions-head">
          <h2>历史会话</h2>
          <button class="primary" onclick="newCase()">新对话</button>
        </div>
        <div class="session-list" id="sessionList"><div class="muted">正在加载...</div></div>
      </aside>
      <main>
        <section class="case">
          <div>
            <h1 id="title">新对话</h1>
            <div class="muted" id="meta">本地 session · helper agent 会先审核上下文，再决定追问或调用 Claude Code</div>
            <div class="context-meter" id="contextMeter">
              <div class="context-meter-track"><div class="context-meter-bar" id="contextMeterBar"></div></div>
              <div class="context-meter-text" id="contextMeterText">上下文窗口：等待会话初始化</div>
            </div>
          </div>
          <div>
            <button onclick="openSettings()">配置</button>
            <button onclick="openLogs()">查看诊断日志</button>
            <button onclick="newCase()">新对话</button>
          </div>
        </section>
        <section class="chat" id="chat"></section>
        <section class="composer">
          <textarea id="input" placeholder="可以问项目问题、描述故障、回答追问，或输入：不清楚"></textarea>
          <div class="composer-meta status-pills"><span class="pill">Agent 审核</span><span class="pill">Claude 只读</span><span class="pill">session 复用</span></div>
          <div class="composer-actions">
            <div class="persona-control"><span class="persona-label">用户视角</span><select id="personaSelect" aria-label="用户视角"><option value="operations">运营人员</option><option value="support">技术支持</option><option value="customer">客户</option><option value="developer">开发人员</option></select></div>
            <button class="primary" id="sendButton" onclick="send()">发送</button>
          </div>
        </section>
      </main>
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
        <div class="field-row">
          <label>Claude 超时毫秒<input id="claudeTimeoutMs" type="number" value="1200000" /></label>
          <label>Claude 预算 USD<input id="claudeMaxBudgetUsd" type="number" step="0.01" value="0.2" /></label>
        </div>
        <div class="field-row">
          <label>Session busy 重试次数<input id="sessionBusyMaxRetries" type="number" value="3" /></label>
          <label>Session busy 重试间隔毫秒<input id="sessionBusyRetryDelayMs" type="number" value="3000" /></label>
        </div>
        <div class="tools">
          <button class="primary" onclick="testModel()">测试模型</button>
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
    let caseId = localStorage.getItem('supper-helper.caseId') || '';
    const chat = document.getElementById('chat');
    const input = document.getElementById('input');
    const sessionList = document.getElementById('sessionList');
    const personaSelect = document.getElementById('personaSelect');
    const sendButton = document.getElementById('sendButton');

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
      document.getElementById('claudeTimeoutMs').value = json.claude.timeoutMs ?? 1200000;
      document.getElementById('claudeMaxBudgetUsd').value = json.claude.maxBudgetUsd || 0.2;
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
        ? agents.map((agent) => '<div class="agent-card"><strong>' + escapeHtml(agent.title || agent.id) + '</strong><div>' + escapeHtml(agent.stage) + ' · ' + escapeHtml(agent.role) + '</div><div>' + escapeHtml(agent.summary || agent.responsibility || '') + '</div><div class="muted">' + escapeHtml(agent.configPath) + ' · 用户可见文本：' + (agent.mayProduceUserFacingText ? '允许' : '不允许') + '</div></div>').join('')
        : '<div class="muted">没有配置 Agent。</div>';
    }

    function add(role, body, options = {}) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      if (role.includes('helper') && !role.includes('thinking') && options.rich !== false) {
        div.innerHTML = renderRichText(body);
      } else {
        div.textContent = body;
      }
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
      return div;
    }

    function addThinking() {
      const div = add('helper thinking', '');
      div.innerHTML = '<span class="thinking-indicator" aria-label="思考中"><span></span><span></span><span></span></span>' + renderAgentActivity([]);
      return div;
    }

    function setCaseHeader(session) {
      const title = document.getElementById('title');
      const meta = document.getElementById('meta');
      const titleText = session?.title || '新对话';
      const metaText = session?.id
        ? session.id + ' · ' + session.status + ' · ' + personaLabel(session.userPersona || personaSelect.value) + ' · Claude session ' + session.claudeSessionId
        : '本地 session · helper agent 会先审核上下文，再决定追问或调用 Claude Code';
      title.textContent = titleText;
      title.title = titleText;
      meta.textContent = metaText;
      meta.title = metaText;
      if (session?.userPersona) {
        personaSelect.value = session.userPersona;
      }
      updateContextMeter(session?.contextUsage);
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
      const sessions = json.sessions || [];
      sessionList.innerHTML = sessions.length
        ? sessions.map((session) => {
          const title = session.title || '新对话';
          const state = (session.pinnedAt ? '置顶 · ' : '') + (session.archivedAt ? '已归档' : session.status);
          const meta = state + ' · ' + (session.lastMessage || '暂无消息');
          const pinAction = session.pinnedAt ? 'unpin' : 'pin';
          const pinLabel = session.pinnedAt ? '取消置顶' : '置顶';
          return '<div class="session-item ' + (session.id === caseId ? 'active' : '') + '" title="' + escapeHtml(title + '\\n' + meta) + '"><button class="session-open" onclick="openSession(\\'' + escapeHtml(session.id) + '\\')"><span class="session-title" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</span><span class="session-meta" title="' + escapeHtml(meta) + '">' + escapeHtml(meta) + '</span></button><div class="session-menu-wrap"><button class="session-more" onclick="toggleSessionMenu(event, \\'' + escapeHtml(session.id) + '\\')" title="更多选项">...</button><div class="session-menu" id="session-menu-' + escapeHtml(session.id) + '"><button onclick="sessionAction(event, \\'' + escapeHtml(session.id) + '\\', \\'' + pinAction + '\\')">' + pinLabel + '</button><button onclick="sessionAction(event, \\'' + escapeHtml(session.id) + '\\', \\'archive\\')">归档</button><button onclick="sessionAction(event, \\'' + escapeHtml(session.id) + '\\', \\'delete\\')">删除</button></div></div></div>';
        }).join('')
        : '<div class="muted">还没有历史会话。</div>';
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
          localStorage.removeItem('supper-helper.caseId');
          chat.innerHTML = '';
          setCaseHeader();
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
      const res = await fetch('/api/session?caseId=' + encodeURIComponent(id));
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'session load failed');
      }
      caseId = json.session.id;
      localStorage.setItem('supper-helper.caseId', caseId);
      chat.innerHTML = '';
      for (const message of json.session.messages || []) {
        add(message.role === 'user' ? 'user' : 'helper', message.body);
      }
      setCaseHeader(json.session);
      restorePendingTurn(json.session);
      await loadSessions();
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
        pending.classList.remove('thinking');
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
        localStorage.setItem('supper-helper.caseId', caseId);
        setCaseHeader({ id: json.caseId, title: json.title, status: json.status, claudeSessionId: json.claudeSessionId || '', userPersona: json.persona, contextUsage: json.contextUsage });
        await loadSessions();
        await pollSessionUntilSettled(pending, json.caseId, json.userMessageId);
      } catch (error) {
        pending.classList.remove('thinking');
        pending.classList.add('error');
        pending.textContent = '请求中断了，我没有继续假装思考。\\n\\n原因：' + errorMessage(error) + '\\n\\n你可以打开“查看诊断日志”看详细链路，或直接重试。';
      }
    }

    async function pollSessionUntilSettled(pending, pollingCaseId, userMessageId) {
      let lastStatusText = '';
      while (true) {
        const sessionRes = await fetch('/api/session?caseId=' + encodeURIComponent(pollingCaseId));
        const sessionJson = await sessionRes.json();
        if (!sessionRes.ok) {
          throw new Error(sessionJson.error || 'session load failed');
        }
        const session = sessionJson.session;
        if (pollingCaseId === caseId) {
          setCaseHeader(session);
        }
        const latestStatus = renderAgentActivity(session.agentActivity || []);
        if (latestStatus && latestStatus !== lastStatusText) {
          lastStatusText = latestStatus;
          pending.innerHTML = '<span class="thinking-indicator" aria-label="处理中"><span></span><span></span><span></span></span>' + latestStatus;
        }
        const latestHelper = [...(session.messages || [])].reverse().find((message) => message.role === 'helper' && (!userMessageId || message.replyToMessageId === userMessageId));
        const finished = !['diagnosing', 'ready_for_diagnosis'].includes(session.status) && latestHelper;
        if (finished) {
          pending.classList.remove('thinking');
          pending.textContent = '';
          await typeWriter(pending, latestHelper.body || '本轮没有返回内容，请查看诊断日志。');
          await loadSessions();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
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

    async function typeWriter(element, text) {
      element.classList.remove('thinking');
      element.classList.add('helper');
      const chars = Array.from(text);
      for (let index = 1; index <= chars.length; index += Math.max(1, Math.ceil(chars.length / 160))) {
        element.innerHTML = renderRichText(chars.slice(0, index).join(''));
        chat.scrollTop = chat.scrollHeight;
        await new Promise((resolve) => setTimeout(resolve, 14));
      }
      element.innerHTML = renderRichText(text);
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
        + '<summary><div class="log-title"><span>' + escapeHtml(block.label || '执行过程') + ' · ' + escapeHtml(block.title || block.summary || '') + '</span><span class="log-label">' + escapeHtml(block.severity || 'info') + '</span></div>'
        + '<div class="log-meta">' + escapeHtml(block.createdAt || '') + ' · ' + escapeHtml(block.agentName || block.actor || '') + ' · ' + escapeHtml(block.phase || '') + '</div>'
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

    async function saveSettings() {
      const status = document.getElementById('settingsStatus');
      status.textContent = '正在保存配置...';
      const res = await fetch('/api/settings/model', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(readSettingsForm(true))
      });
      const modelJson = await res.json();
      const claudeRes = await fetch('/api/settings/claude', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          timeoutMs: Number(document.getElementById('claudeTimeoutMs').value || 1200000),
          maxBudgetUsd: Number(document.getElementById('claudeMaxBudgetUsd').value || 0.2),
          sessionBusyMaxRetries: Number(document.getElementById('sessionBusyMaxRetries').value || 3),
          sessionBusyRetryDelayMs: Number(document.getElementById('sessionBusyRetryDelayMs').value || 3000)
        })
      });
      const claudeJson = await claudeRes.json();
      status.textContent = modelJson.agent && claudeJson.claude ? '配置已保存。' : '保存失败：' + JSON.stringify({modelJson, claudeJson});
      document.getElementById('apiKey').value = '';
      await loadConfig();
    }

    function closeLogs() {
      document.getElementById('drawer').classList.remove('open');
    }
    async function newCase() {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ title: '新对话', persona: personaSelect.value })
      });
      const json = await res.json();
      caseId = json.session.id;
      localStorage.setItem('supper-helper.caseId', caseId);
      chat.innerHTML = '';
      setCaseHeader(json.session);
      await loadSessions();
    }
    function errorMessage(error) {
      return error instanceof Error ? error.message : String(error);
    }
    function personaLabel(persona) {
      return ({operations: '运营人员', support: '技术支持', customer: '客户', developer: '开发人员'})[persona] || '运营人员';
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
        .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
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
    document.addEventListener('click', () => {
      document.querySelectorAll('.session-menu.open').forEach((menu) => menu.classList.remove('open'));
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        send();
      }
    });
    loadConfig();
    loadSessions().then(() => {
      if (caseId) {
        openSession(caseId).catch(() => {
          localStorage.removeItem('supper-helper.caseId');
          caseId = '';
          setCaseHeader();
        });
      }
    });
  </script>
</body>
</html>`;
}
