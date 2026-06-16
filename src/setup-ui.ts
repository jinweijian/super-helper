export function renderSetupApp(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>super helper setup</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f6f8fb; color: #172033; }
    main { max-width: 1040px; margin: 0 auto; padding: 32px 18px 56px; display: grid; gap: 18px; }
    .hero, section { background: #fff; border: 1px solid #dbe3ef; border-radius: 14px; padding: 18px; box-shadow: 0 8px 28px rgba(16,24,40,.06); }
    h1, h2 { margin: 0 0 8px; }
    .muted { color: #667085; line-height: 1.6; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 6px; font-weight: 700; font-size: 13px; color: #344054; }
    input, select { height: 40px; border: 1px solid #cbd5e1; border-radius: 9px; padding: 0 10px; font: inherit; }
    button { height: 40px; border: 1px solid #1f6feb; border-radius: 9px; padding: 0 14px; background: #1f6feb; color: white; font-weight: 800; cursor: pointer; }
    button.secondary { background: #fff; color: #1f2937; border-color: #cbd5e1; }
    details { border: 1px solid #dbe3ef; border-radius: 12px; padding: 12px; }
    summary { cursor: pointer; font-weight: 800; }
    .progress { height: 10px; border-radius: 999px; background: #e5eaf2; overflow: hidden; }
    .bar { height: 100%; width: 0%; background: #1f6feb; transition: width .2s ease; }
    .stages { display: grid; gap: 8px; }
    .stage { display: flex; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid #e5eaf2; border-radius: 10px; background: #fbfcfe; }
    .warning { border-color: #f2c94c; background: #fff8df; color: #6f4b00; }
    .ok { border-color: #9bd5ad; background: #f0fbf4; color: #146c2e; }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <div class="hero">
      <h1>QuickStart：一键配置 super helper</h1>
      <p class="muted">把项目初始化、知识库切片、Agent 模型配置、Embedding 模型配置、Rerank 模型配置和健康检查放进同一次 onDashboard 流程。</p>
    </div>

    <section>
      <h2>QuickStart</h2>
      <div class="grid">
        <label>Workspace Path <input id="workspacePath" placeholder="/path/to/project" /></label>
        <label>Knowledge pathRoot <input id="knowledgeRoot" placeholder="/path/to/knowledge-store" /></label>
        <label>Source Dir <input id="sourceDir" placeholder="/path/to/local-docs" /></label>
        <label>绑定模式
          <select id="bindMode">
            <option value="loopback">仅本机 loopback</option>
            <option value="lan">可信内网 lan / 0.0.0.0</option>
          </select>
        </label>
        <label>Agent preset <input id="agentModel" placeholder="MiniMax-M1 / gpt-4.1 / ..." /></label>
        <label>Agent API Key <input id="agentKey" type="password" autocomplete="off" /></label>
        <label>Embedding preset <input id="embeddingModel" placeholder="Qwen/Qwen3-Embedding-0.6B" /></label>
        <label>Embedding API Key <input id="embeddingKey" type="password" autocomplete="off" /></label>
        <label>Rerank preset <input id="rerankModel" placeholder="Qwen/Qwen3-Reranker-8B" /></label>
        <label>Rerank API Key <input id="rerankKey" type="password" autocomplete="off" /></label>
      </div>
      <p class="warning" id="lanWarning" hidden>当前页面和 API 暴露在可信内网，MVP 尚未实现鉴权。请只在可信内网使用。</p>
    </section>

    <section>
      <details>
        <summary>高级设置</summary>
        <div class="grid" style="margin-top: 12px">
          <label>端口 <input id="port" type="number" value="4317" /></label>
          <label>Embedding dimensions <input id="dimensions" type="number" value="1024" /></label>
          <label>Embedding batchSize <input id="batchSize" type="number" value="16" /></label>
          <label>Rerank topN <input id="topN" type="number" value="2" /></label>
        </div>
      </details>
    </section>

    <section>
      <h2>检查并执行</h2>
      <p class="muted">预检会检查路径、端口、模型连通性、知识库索引兼容性。耗时任务会通过 EventSource/SSE 推送真实进度。</p>
      <button id="runButton">检查并执行</button>
      <button class="secondary" id="retryButton">从失败阶段重试</button>
      <pre id="preflight">等待预检结果...</pre>
    </section>

    <section>
      <h2>进度</h2>
      <div class="progress"><div class="bar" id="bar"></div></div>
      <p id="progressText" class="muted">尚未开始</p>
      <div class="stages" id="stages"></div>
      <p class="muted" id="counters">自动发布 0，待审核 0，blocked 0。</p>
    </section>

    <section class="ok" id="done" hidden>
      <h2>配置完成</h2>
      <p>现在可以进入 Dashboard。</p>
      <button onclick="location.href='/'">进入 Dashboard</button>
    </section>
  </main>
  <script>
    const state = { runId: null, eventSource: null };
    const $ = (id) => document.getElementById(id);
    $('bindMode').addEventListener('change', () => { $('lanWarning').hidden = $('bindMode').value !== 'lan'; });

    async function loadState() {
      const snapshot = await fetch('/api/onboarding').then((res) => res.json());
      if (snapshot.latestRun) renderRun(snapshot.latestRun);
    }

    function draftPayload() {
      return {
        draft: {
          version: 1,
          workspace: { id: 'current', name: 'Current Project', rootPath: $('workspacePath').value },
          knowledge: { rootDir: $('knowledgeRoot').value, sourceDir: $('sourceDir').value || undefined, buildVectorIndex: true },
          server: { bindMode: $('bindMode').value, port: Number($('port').value || 4317) },
          agent: { providerId: 'default', provider: { type: 'openai-compatible', baseUrl: '', model: $('agentModel').value } },
          embedding: { enabled: true, provider: 'siliconflow', model: $('embeddingModel').value, dimensions: Number($('dimensions').value || 1024), distance: 'cosine', batchSize: Number($('batchSize').value || 16) },
          rerank: { enabled: true, provider: 'siliconflow', model: $('rerankModel').value, topN: Number($('topN').value || 2) }
        },
        secrets: {
          agentApiKey: $('agentKey').value || undefined,
          embeddingApiKey: $('embeddingKey').value || undefined,
          rerankApiKey: $('rerankKey').value || undefined
        }
      };
    }

    async function runSetup() {
      await fetch('/api/onboarding/draft', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draftPayload()) });
      const validation = await fetch('/api/onboarding/validate', { method: 'POST' }).then((res) => res.json());
      $('preflight').textContent = JSON.stringify(validation, null, 2);
      if (!validation.ok) return;
      const started = await fetch('/api/onboarding/runs', { method: 'POST' }).then((res) => res.json());
      state.runId = started.run.id;
      renderRun(started.run);
      connectEvents(started.run.id);
    }

    function connectEvents(runId) {
      if (state.eventSource) state.eventSource.close();
      state.eventSource = new EventSource('/api/onboarding/runs/' + runId + '/events');
      state.eventSource.onmessage = pollSnapshot;
      state.eventSource.addEventListener('run.snapshot', (event) => renderRun(JSON.parse(event.data).run));
      state.eventSource.addEventListener('stage.progress', (event) => renderRun(JSON.parse(event.data).run));
      state.eventSource.addEventListener('stage.completed', (event) => renderRun(JSON.parse(event.data).run));
      state.eventSource.addEventListener('stage.failed', (event) => renderRun(JSON.parse(event.data).run));
      state.eventSource.addEventListener('run.completed', (event) => {
        const run = JSON.parse(event.data).run;
        renderRun(run);
        $('done').hidden = false;
        location.href = '/';
      });
      state.eventSource.onerror = () => setTimeout(pollSnapshot, 1500);
    }

    async function pollSnapshot() {
      if (!state.runId) return;
      const snapshot = await fetch('/api/onboarding/runs/' + state.runId).then((res) => res.json());
      renderRun(snapshot.run);
    }

    function renderRun(run) {
      if (!run) return;
      state.runId = run.id;
      $('bar').style.width = Math.max(0, Math.min(100, run.overallProgress || 0)) + '%';
      $('progressText').textContent = run.status + ' · ' + (run.overallProgress || 0) + '%';
      $('stages').innerHTML = (run.stages || []).map((stage) => '<div class="stage"><strong>' + stage.id + '</strong><span>' + stage.status + ' ' + (stage.processed ?? '') + '/' + (stage.total ?? '') + '</span></div>').join('');
      const counters = run.counters || {};
      $('counters').textContent = '自动发布 ' + (counters.publishedSlices || 0) + '，待审核 ' + (counters.pendingReviewSlices || 0) + '，blocked ' + (counters.blockedSlices || 0) + '。';
    }

    $('runButton').addEventListener('click', runSetup);
    $('retryButton').addEventListener('click', async () => {
      if (!state.runId) return;
      const retried = await fetch('/api/onboarding/runs/' + state.runId + '/retry', { method: 'POST' }).then((res) => res.json());
      renderRun(retried.run);
      connectEvents(retried.run.id);
    });
    loadState();
  </script>
</body>
</html>`;
}
