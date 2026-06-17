export function renderSetupApp(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>super helper setup</title>
  <style>
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
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
    .path-row { display: grid; grid-template-columns: 1fr auto; gap: 6px; }
    .path-row input { width: 100%; }
    .path-row button { white-space: nowrap; }
    .modal-backdrop { position: fixed; inset: 0; background: rgba(16,24,40,.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
    .modal { background: #fff; border-radius: 14px; border: 1px solid #dbe3ef; box-shadow: 0 24px 48px rgba(16,24,40,.18); width: min(640px, 92vw); max-height: 80vh; display: grid; grid-template-rows: auto auto 1fr auto; overflow: hidden; }
    .modal header, .modal footer { padding: 14px 18px; }
    .modal header { border-bottom: 1px solid #e5eaf2; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .modal footer { border-top: 1px solid #e5eaf2; display: flex; justify-content: flex-end; gap: 8px; }
    .modal h3 { margin: 0; font-size: 16px; }
    .modal .breadcrumb { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #475467; background: #f6f8fb; border: 1px solid #e5eaf2; border-radius: 8px; padding: 8px 10px; word-break: break-all; }
    .modal .breadcrumb-row { padding: 10px 18px 0; display: flex; gap: 8px; align-items: center; }
    .modal .breadcrumb-row button { height: 30px; padding: 0 10px; font-size: 12px; }
    .modal .body { overflow: auto; padding: 8px 6px 8px 18px; }
    .modal .entry { display: flex; justify-content: space-between; padding: 8px 10px; border-radius: 8px; cursor: pointer; font-size: 14px; }
    .modal .entry:hover { background: #f0f4fb; }
    .modal .entry .meta { color: #667085; font-size: 12px; }
    .modal .entry.file { color: #475467; cursor: default; }
    .modal .entry.file:hover { background: transparent; }
    .modal .empty { color: #98a2b3; padding: 24px; text-align: center; font-size: 13px; }
    .modal .error { color: #b42318; padding: 12px 14px; background: #fee4e2; border-radius: 8px; font-size: 13px; margin: 8px 18px; }
    details { border: 1px solid #dbe3ef; border-radius: 12px; padding: 12px; }
    summary { cursor: pointer; font-weight: 800; }
    .progress { height: 10px; border-radius: 999px; background: #e5eaf2; overflow: hidden; }
    .bar { height: 100%; width: 0%; background: #1f6feb; transition: width .2s ease; }
    .stages { display: grid; gap: 8px; }
    .stage { display: flex; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid #e5eaf2; border-radius: 10px; background: #fbfcfe; }
    .review-item { display: grid; gap: 6px; padding: 12px; border: 1px solid #e5eaf2; border-radius: 10px; background: #fbfcfe; }
    .review-head { display: flex; justify-content: space-between; gap: 10px; align-items: start; }
    .badge { display: inline-flex; align-items: center; height: 24px; border-radius: 999px; padding: 0 10px; background: #fff4d6; color: #8a5a00; font-size: 12px; font-weight: 800; }
    .badge.error { background: #fee4e2; color: #b42318; }
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
        <label>项目目录
          <span class="path-row">
            <input id="workspacePath" placeholder="被 super helper 管理的代码根目录，例如 /Users/king/my/project" />
            <button type="button" class="pathBrowse secondary" data-target="workspacePath">浏览…</button>
          </span>
        </label>
        <label>知识库目录
          <span class="path-row">
            <input id="knowledgeRoot" placeholder="知识库输出根目录，存放切片、索引和向量，例如 /Users/king/Documents/knowledge" />
            <button type="button" class="pathBrowse secondary" data-target="knowledgeRoot">浏览…</button>
          </span>
        </label>
        <label>知识源目录
          <span class="path-row">
            <input id="sourceDir" placeholder="放你的产品/技术文档的地方，工具会从这里读 PDF、Markdown 等" />
            <button type="button" class="pathBrowse secondary" data-target="sourceDir">浏览…</button>
          </span>
        </label>
        <label>绑定模式
          <select id="bindMode">
            <option value="loopback">仅本机 loopback</option>
            <option value="lan">可信内网 lan / 0.0.0.0</option>
          </select>
        </label>
        <label>Agent Base URL <input id="agentBaseUrl" value="https://api.minimaxi.com/v1" /></label>
        <label>Agent preset <input id="agentModel" placeholder="MiniMax-M1 / gpt-4.1 / ..." /></label>
        <label>Agent API Key <input id="agentKey" type="password" autocomplete="off" /></label>
        <label>Embedding Base URL <input id="embeddingBaseUrl" value="https://api.siliconflow.cn/v1" /></label>
        <label>Embedding preset <input id="embeddingModel" placeholder="Qwen/Qwen3-Embedding-0.6B" /></label>
        <label>Embedding API Key <input id="embeddingKey" type="password" autocomplete="off" /></label>
        <label>Rerank Base URL <input id="rerankBaseUrl" value="https://api.siliconflow.cn/v1" /></label>
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

    <section id="reviewPanel" hidden>
      <h2>审核知识切片</h2>
      <p class="muted" id="reviewSummary">等待审核项...</p>
      <div class="stages" id="reviewItems"></div>
      <label style="margin-top: 12px">审核备注 <input id="reviewNotes" placeholder="例如：已人工确认可作为知识库内容" /></label>
      <button id="acceptReviewButton">接受警告并发布</button>
      <button class="secondary" id="refreshReviewButton">刷新审核项</button>
    </section>

    <section class="ok" id="done" hidden>
      <h2>开始使用</h2>
      <p>配置和审核已完成，可以进入 Dashboard。</p>
      <button onclick="location.href='/'">进入 Dashboard</button>
    </section>
  </main>

  <div id="pathPicker" class="modal-backdrop" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pathPickerTitle">
      <header>
        <h3 id="pathPickerTitle">选择目录</h3>
        <button type="button" class="secondary" id="pathPickerClose">关闭</button>
      </header>
      <div class="breadcrumb-row">
        <button type="button" class="secondary" id="pathPickerHome">家目录</button>
        <button type="button" class="secondary" id="pathPickerUp" disabled>上一级</button>
      </div>
      <div class="breadcrumb" id="pathPickerPath">/</div>
      <div id="pathPickerError" class="error" hidden></div>
      <div class="body" id="pathPickerBody"></div>
      <footer>
        <button type="button" class="secondary" id="pathPickerCancel">取消</button>
        <button type="button" id="pathPickerConfirm">选定此目录</button>
      </footer>
    </div>
  </div>
  <script>
    const state = { runId: null, eventSource: null, review: null };
    const $ = (id) => document.getElementById(id);
    $('bindMode').addEventListener('change', () => { $('lanWarning').hidden = $('bindMode').value !== 'lan'; });

    async function loadState() {
      const snapshot = await fetch('/api/onboarding').then((res) => res.json());
      if (snapshot.latestRun) renderRun(snapshot.latestRun);
      renderReview(snapshot.review);
      if (snapshot.latestRun && snapshot.latestRun.status === 'completed' && !needsReview(snapshot.latestRun, snapshot.review)) {
        showDone();
      }
    }

    function draftPayload() {
      return {
        draft: {
          version: 1,
          workspace: { id: 'current', name: 'Current Project', rootPath: $('workspacePath').value },
          knowledge: { rootDir: $('knowledgeRoot').value, sourceDir: $('sourceDir').value || undefined, buildVectorIndex: true },
          server: { bindMode: $('bindMode').value, port: Number($('port').value || 4317) },
          agent: { providerId: 'default', provider: { type: 'openai-compatible', baseUrl: $('agentBaseUrl').value, model: $('agentModel').value } },
          embedding: { enabled: true, provider: 'siliconflow', baseUrl: $('embeddingBaseUrl').value, model: $('embeddingModel').value, dimensions: Number($('dimensions').value || 1024), distance: 'cosine', batchSize: Number($('batchSize').value || 16) },
          rerank: { enabled: true, provider: 'siliconflow', baseUrl: $('rerankBaseUrl').value, model: $('rerankModel').value, topN: Number($('topN').value || 2) }
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
        handleCompletedRun(run);
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

    async function handleCompletedRun(run) {
      const review = await refreshReview();
      if (needsReview(run, review)) {
        $('done').hidden = true;
        $('reviewPanel').hidden = false;
        return;
      }
      showDone();
      location.href = '/';
    }

    async function refreshReview() {
      const result = await fetch('/api/onboarding/review').then((res) => res.json());
      renderReview(result.review);
      return result.review;
    }

    function renderReview(review) {
      state.review = review || { required: false, pendingCount: 0, blockedCount: 0, items: [] };
      const required = state.review.required;
      $('reviewPanel').hidden = !required;
      if (!required) {
        $('reviewItems').innerHTML = '';
        $('reviewSummary').textContent = '没有待审核切片。';
        return;
      }
      $('reviewSummary').textContent = '待审核 ' + state.review.pendingCount + '，blocked ' + state.review.blockedCount + '。';
      $('reviewItems').innerHTML = (state.review.items || []).map((item) => {
        const issues = (item.issues || []).slice(0, 3).map((issue) => escapeHtml(issue.code + ' · ' + issue.message)).join('<br>');
        const badgeClass = item.qualitySeverity === 'error' ? 'badge error' : 'badge';
        return '<div class="review-item"><div class="review-head"><strong>' + escapeHtml(item.title) + '</strong><span class="' + badgeClass + '">' + escapeHtml(item.qualitySeverity) + '</span></div><div class="muted">' + escapeHtml(item.sourceDocumentId + ' / ' + item.id) + '</div><div class="muted">' + escapeHtml(item.excerptPreview || '') + '</div><div class="muted">' + issues + '</div></div>';
      }).join('');
      const canAccept = (state.review.items || []).some((item) => item.qualitySeverity === 'warn');
      $('acceptReviewButton').disabled = !canAccept;
    }

    function needsReview(run, review) {
      const counters = run?.counters || {};
      return Boolean(review?.required || counters.pendingReviewSlices > 0 || counters.blockedSlices > 0);
    }

    function showDone() {
      $('reviewPanel').hidden = true;
      $('done').hidden = false;
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    // ----- directory picker -----
    const picker = {
      targetInputId: null,
      current: null,
      parent: null,
      root: null,
    };

    async function fetchListing(path) {
      const query = path ? '?path=' + encodeURIComponent(path) : '';
      const res = await fetch('/api/fs/dirs' + query);
      const body = await res.json();
      if (!res.ok) {
        const message = body && body.error ? body.error : ('HTTP ' + res.status);
        throw new Error(message);
      }
      return body;
    }

    function renderPicker(listing) {
      picker.current = listing.current;
      picker.parent = listing.parent;
      picker.root = listing.root;
      $('pathPickerPath').textContent = listing.current;
      $('pathPickerUp').disabled = !listing.parent;
      const body = $('pathPickerBody');
      body.innerHTML = '';
      if (!listing.entries.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '此目录下没有可显示的子目录';
        body.appendChild(empty);
        return;
      }
      for (const entry of listing.entries) {
        const row = document.createElement('div');
        row.className = 'entry ' + entry.type;
        const name = document.createElement('span');
        name.textContent = entry.name;
        const meta = document.createElement('span');
        meta.className = 'meta';
        if (entry.type === 'dir') {
          meta.textContent = '目录';
          row.addEventListener('click', () => navigatePicker(resolve(listing.current, entry.name)).catch(showPickerError));
        } else {
          const size = entry.size != null ? ' · ' + formatBytes(entry.size) : '';
          meta.textContent = '文件' + size;
        }
        row.appendChild(name);
        row.appendChild(meta);
        body.appendChild(row);
      }
    }

    function showPickerError(error) {
      const box = $('pathPickerError');
      box.textContent = error && error.message ? error.message : String(error);
      box.hidden = false;
    }

    function clearPickerError() {
      $('pathPickerError').hidden = true;
    }

    async function navigatePicker(path) {
      clearPickerError();
      try {
        const listing = await fetchListing(path);
        renderPicker(listing);
      } catch (error) {
        showPickerError(error);
      }
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
      return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    }

    function resolve(base, child) {
      // simple path join that handles trailing slashes
      if (base.endsWith('/')) return base + child;
      return base + '/' + child;
    }

    async function openPicker(targetInputId) {
      picker.targetInputId = targetInputId;
      $('pathPickerTitle').textContent = '选择目录 · 写入：' + targetInputId;
      $('pathPicker').hidden = false;
      const seed = document.getElementById(targetInputId).value.trim() || '';
      await navigatePicker(seed);
    }

    function closePicker() {
      $('pathPicker').hidden = true;
      picker.targetInputId = null;
    }

    document.querySelectorAll('.pathBrowse').forEach((btn) => {
      btn.addEventListener('click', () => openPicker(btn.dataset.target));
    });
    $('pathPickerClose').addEventListener('click', closePicker);
    $('pathPickerCancel').addEventListener('click', closePicker);
    $('pathPickerConfirm').addEventListener('click', () => {
      if (picker.targetInputId && picker.current) {
        document.getElementById(picker.targetInputId).value = picker.current;
      }
      closePicker();
    });
    $('pathPickerUp').addEventListener('click', () => {
      if (picker.parent) navigatePicker(picker.parent).catch(showPickerError);
    });
    $('pathPickerHome').addEventListener('click', () => navigatePicker(picker.root).catch(showPickerError));
    $('pathPicker').addEventListener('click', (event) => {
      if (event.target === $('pathPicker')) closePicker();
    });

    $('runButton').addEventListener('click', runSetup);
    $('acceptReviewButton').addEventListener('click', async () => {
      const review = state.review || { items: [] };
      const ids = review.items.filter((item) => item.qualitySeverity === 'warn').map((item) => item.id);
      const result = await fetch('/api/onboarding/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'accept_warnings',
          reviewer: 'super-helper-dashboard',
          notes: $('reviewNotes').value || 'Dashboard reviewer accepted warning-quality slices for publish.',
          ids
        })
      }).then((res) => res.json());
      renderReview(result.review);
      $('preflight').textContent = JSON.stringify(result, null, 2);
      if (!result.review.required) {
        showDone();
        location.href = '/';
      }
    });
    $('refreshReviewButton').addEventListener('click', refreshReview);
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
