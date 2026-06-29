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
    .review-toolbar, .review-selection, .review-actions, .review-pager { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-top: 12px; }
    .review-toolbar label { min-width: 180px; flex: 1; }
    .review-list { display: grid; gap: 10px; margin-top: 12px; }
    .review-item { display: grid; gap: 6px; padding: 12px; border: 1px solid #e5eaf2; border-radius: 10px; background: #fbfcfe; }
    .review-item.selected { border-color: #1f6feb; background: #f4f8ff; }
    .review-head { display: flex; justify-content: space-between; gap: 10px; align-items: start; }
    .review-check { display: flex; grid-template-columns: auto 1fr; gap: 8px; align-items: center; font-weight: 800; font-size: 14px; color: #172033; }
    .review-check input { width: 16px; height: 16px; padding: 0; }
    .issue-list { display: grid; gap: 8px; }
    .issue { border-left: 3px solid #f2c94c; padding-left: 10px; display: grid; gap: 4px; }
    .issue.error { border-left-color: #d92d20; }
    .issue-title { font-weight: 800; color: #344054; }
    .issue-detail { color: #667085; line-height: 1.55; }
    .review-page-text, .selection-text { color: #667085; line-height: 1.6; }
    .badge { display: inline-flex; align-items: center; height: 24px; border-radius: 999px; padding: 0 10px; background: #fff4d6; color: #8a5a00; font-size: 12px; font-weight: 800; }
    .badge.error { background: #fee4e2; color: #b42318; }
    button.danger { background: #b42318; border-color: #b42318; color: #fff; }
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
          <label>Rerank topN <input id="topN" type="number" value="8" /></label>
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
      <div class="review-toolbar">
        <label>严重级别
          <select id="reviewSeverity">
            <option value="all">全部</option>
            <option value="warn">仅警告</option>
            <option value="error">仅 blocked</option>
          </select>
        </label>
        <label>搜索
          <input id="reviewSearch" placeholder="按标题、来源、模块或问题原因搜索" />
        </label>
        <button class="secondary" id="refreshReviewButton">刷新审核项</button>
      </div>
      <div class="review-selection">
        <button class="secondary" id="selectReviewPageButton">选择当前页</button>
        <button class="secondary" id="clearReviewSelectionButton">清空选择</button>
        <span class="selection-text" id="reviewSelectionSummary">已选择 0 条。</span>
      </div>
      <div class="review-list" id="reviewItems"></div>
      <div class="review-pager">
        <button class="secondary" id="reviewPrevButton">上一页</button>
        <span class="review-page-text" id="reviewPageText">第 1 页</span>
        <button class="secondary" id="reviewNextButton">下一页</button>
      </div>
      <label style="margin-top: 12px">审核备注 <input id="reviewNotes" placeholder="例如：已人工确认可作为知识库内容" /></label>
      <div class="review-actions">
        <button id="acceptSelectedReviewButton">发布选中</button>
        <button class="secondary" id="requestEditsReviewButton">退回修改</button>
        <button class="danger" id="rejectReviewButton">不发布选中</button>
      </div>
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
    const state = {
      runId: null,
      eventSource: null,
      review: null,
      draft: null,
      reviewOffset: 0,
      reviewLimit: 20,
      selectedReviewIds: new Set(),
      selectedReviewMeta: new Map(),
      reviewSearchTimer: null
    };
    const $ = (id) => document.getElementById(id);
    $('bindMode').addEventListener('change', () => { $('lanWarning').hidden = $('bindMode').value !== 'lan'; });

    async function loadState() {
      const snapshot = await fetch('/api/onboarding').then((res) => res.json());
      hydrateDraft(snapshot.draft);
      if (snapshot.latestRun) renderRun(snapshot.latestRun);
      renderReview(snapshot.review);
      if (snapshot.latestRun && snapshot.latestRun.status === 'completed' && !needsReview(snapshot.latestRun, snapshot.review)) {
        showDone();
      }
    }

    function hydrateDraft(draft) {
      if (!draft) return;
      state.draft = draft;
      $('workspacePath').value = draft.workspace?.rootPath || '';
      $('knowledgeRoot').value = draft.knowledge?.rootDir || '';
      $('sourceDir').value = draft.knowledge?.sourceDir || '';
      $('bindMode').value = draft.server?.bindMode || 'loopback';
      $('lanWarning').hidden = $('bindMode').value !== 'lan';
      $('port').value = draft.server?.port || 4317;
      $('agentBaseUrl').value = draft.agent?.provider?.baseUrl || 'https://api.minimaxi.com/v1';
      $('agentModel').value = draft.agent?.provider?.model || '';
      $('agentKey').placeholder = draft.agent?.provider?.hasApiKey ? '已保存，留空继续使用' : '';
      $('embeddingBaseUrl').value = draft.embedding?.baseUrl || 'https://api.siliconflow.cn/v1';
      $('embeddingModel').value = draft.embedding?.model || '';
      $('embeddingKey').placeholder = draft.embedding?.hasApiKey ? '已保存，留空继续使用' : '';
      $('rerankBaseUrl').value = draft.rerank?.baseUrl || 'https://api.siliconflow.cn/v1';
      $('rerankModel').value = draft.rerank?.model || '';
      $('rerankKey').placeholder = draft.rerank?.hasApiKey ? '已保存，留空继续使用' : '';
      $('dimensions').value = draft.embedding?.dimensions || 1024;
      $('batchSize').value = draft.embedding?.batchSize || 16;
      $('topN').value = draft.rerank?.topN || 8;
    }

    function draftPayload() {
      const current = state.draft || {};
      const workspace = current.workspace || {};
      const knowledge = current.knowledge || {};
      const server = current.server || {};
      const agentProvider = publicProviderInput(current.agent?.provider);
      const embedding = publicProviderInput(current.embedding);
      const rerank = publicProviderInput(current.rerank);
      return {
        draft: {
          version: 1,
          workspace: {
            id: workspace.id || 'current',
            name: workspace.name || 'Current Project',
            rootPath: $('workspacePath').value
          },
          knowledge: {
            rootDir: $('knowledgeRoot').value,
            sourceDir: $('sourceDir').value || undefined,
            buildVectorIndex: knowledge.buildVectorIndex ?? true
          },
          server: {
            bindMode: $('bindMode').value,
            host: server.host,
            port: Number($('port').value || 4317)
          },
          agent: {
            providerId: current.agent?.providerId || 'default',
            provider: {
              ...agentProvider,
              type: agentProvider.type || 'openai-compatible',
              baseUrl: $('agentBaseUrl').value,
              model: $('agentModel').value
            }
          },
          embedding: {
            ...embedding,
            enabled: current.embedding?.enabled ?? true,
            provider: embedding.provider || 'siliconflow',
            baseUrl: $('embeddingBaseUrl').value,
            model: $('embeddingModel').value,
            dimensions: Number($('dimensions').value || 1024),
            distance: embedding.distance || 'cosine',
            batchSize: Number($('batchSize').value || 16)
          },
          rerank: {
            ...rerank,
            enabled: current.rerank?.enabled ?? true,
            provider: rerank.provider || 'siliconflow',
            baseUrl: $('rerankBaseUrl').value,
            model: $('rerankModel').value,
            topN: Number($('topN').value || 8)
          }
        },
        secrets: {
          agentApiKey: $('agentKey').value || undefined,
          embeddingApiKey: $('embeddingKey').value || undefined,
          rerankApiKey: $('rerankKey').value || undefined
        }
      };
    }

    function publicProviderInput(provider) {
      const copy = { ...(provider || {}) };
      delete copy.apiKey;
      delete copy.apiKeyEnv;
      delete copy.hasApiKey;
      if (copy.apiKeyRef?.source !== 'env') {
        delete copy.apiKeyRef;
      }
      return copy;
    }

    async function runSetup() {
      const saved = await fetch('/api/onboarding/draft', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draftPayload()) }).then((res) => res.json());
      hydrateDraft(saved.draft);
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

    async function refreshReview(options = {}) {
      if (options.resetOffset) state.reviewOffset = 0;
      const params = new URLSearchParams();
      params.set('offset', String(state.reviewOffset));
      params.set('limit', String(state.reviewLimit));
      params.set('severity', $('reviewSeverity') ? $('reviewSeverity').value : 'all');
      params.set('search', $('reviewSearch') ? $('reviewSearch').value.trim() : '');
      const result = await fetch('/api/onboarding/review?' + params.toString()).then((res) => res.json());
      renderReview(result.review);
      return result.review;
    }

    function renderReview(review) {
      state.review = review || {
        required: false,
        pendingCount: 0,
        blockedCount: 0,
        totalCount: 0,
        page: { offset: 0, limit: state.reviewLimit, total: 0, returned: 0, hasMore: false, severity: 'all', search: '' },
        items: []
      };
      const required = state.review.required;
      $('reviewPanel').hidden = !required;
      syncReviewControlsFromState();
      if (!required) {
        $('reviewItems').innerHTML = '';
        $('reviewSummary').textContent = '没有待审核切片。';
        updateReviewButtons();
        return;
      }
      const page = state.review.page || { offset: 0, limit: state.reviewLimit, total: state.review.items.length, returned: state.review.items.length, hasMore: false };
      $('reviewSummary').textContent = '待审核 ' + state.review.pendingCount + '，blocked ' + state.review.blockedCount + '，当前筛选 ' + page.total + ' 条。';
      $('reviewItems').innerHTML = (state.review.items || []).map((item) => {
        const selected = state.selectedReviewIds.has(item.id);
        const issues = (item.issues || []).slice(0, 4).map((issue) => renderReviewIssue(issue)).join('');
        const badgeClass = item.qualitySeverity === 'error' ? 'badge error' : 'badge';
        return '<div class="review-item' + (selected ? ' selected' : '') + '">' +
          '<div class="review-head"><label class="review-check"><input type="checkbox" class="reviewSelect" data-id="' + escapeHtml(item.id) + '"' + (selected ? ' checked' : '') + ' />' + escapeHtml(item.title) + '</label><span class="' + badgeClass + '">' + escapeHtml(item.qualitySeverity) + '</span></div>' +
          '<div class="muted">' + escapeHtml(item.sourceDocumentId + ' / ' + item.id) + '</div>' +
          '<div class="muted">' + escapeHtml(item.path || '') + '</div>' +
          '<div class="muted">' + escapeHtml(item.excerptPreview || '') + '</div>' +
          '<div class="issue-list">' + issues + '</div>' +
        '</div>';
      }).join('');
      document.querySelectorAll('.reviewSelect').forEach((checkbox) => {
        checkbox.addEventListener('change', () => toggleReviewSelection(checkbox.dataset.id, checkbox.checked));
      });
      renderReviewPage(page);
      updateReviewButtons();
    }

    function syncReviewControlsFromState() {
      const page = state.review?.page;
      if (!page) return;
      state.reviewOffset = page.offset || 0;
      state.reviewLimit = page.limit || state.reviewLimit;
      if ($('reviewSeverity')) $('reviewSeverity').value = page.severity || 'all';
      if ($('reviewSearch')) $('reviewSearch').value = page.search || '';
    }

    function renderReviewIssue(issue) {
      const explanation = issue.explanation || {
        reason: '原因：质量审计标记了该问题。',
        impact: '影响：该切片暂不满足自动发布质量门禁。',
        suggestion: '建议：人工确认后再选择发布、退回或不发布。',
        missingInfo: ['人工审核结论']
      };
      const missing = (explanation.missingInfo || []).length
        ? '<div class="issue-detail">缺少：' + escapeHtml(explanation.missingInfo.join('、')) + '</div>'
        : '';
      return '<div class="issue ' + (issue.severity === 'error' ? 'error' : '') + '">' +
        '<div class="issue-title">' + escapeHtml(issue.code + ' · ' + issue.severity) + '</div>' +
        '<div class="issue-detail">' + escapeHtml(explanation.reason) + '</div>' +
        '<div class="issue-detail">' + escapeHtml(explanation.impact) + '</div>' +
        '<div class="issue-detail">' + escapeHtml(explanation.suggestion) + '</div>' +
        missing +
      '</div>';
    }

    function renderReviewPage(page) {
      const start = page.total === 0 ? 0 : page.offset + 1;
      const end = page.offset + page.returned;
      $('reviewPageText').textContent = '显示 ' + start + '-' + end + ' / ' + page.total;
      $('reviewPrevButton').disabled = page.offset <= 0;
      $('reviewNextButton').disabled = !page.hasMore;
    }

    function toggleReviewSelection(id, checked) {
      const item = (state.review?.items || []).find((entry) => entry.id === id);
      if (!item) return;
      if (checked) {
        state.selectedReviewIds.add(id);
        state.selectedReviewMeta.set(id, { title: item.title, qualitySeverity: item.qualitySeverity });
      } else {
        state.selectedReviewIds.delete(id);
        state.selectedReviewMeta.delete(id);
      }
      renderReview(state.review);
    }

    function selectCurrentReviewPage() {
      for (const item of state.review?.items || []) {
        state.selectedReviewIds.add(item.id);
        state.selectedReviewMeta.set(item.id, { title: item.title, qualitySeverity: item.qualitySeverity });
      }
      renderReview(state.review);
    }

    function clearReviewSelection() {
      state.selectedReviewIds.clear();
      state.selectedReviewMeta.clear();
      renderReview(state.review);
    }

    function updateReviewButtons() {
      const selectedCount = state.selectedReviewIds.size;
      const selected = Array.from(state.selectedReviewMeta.values());
      const hasError = selected.some((item) => item.qualitySeverity === 'error');
      const hasWarn = selected.some((item) => item.qualitySeverity === 'warn');
      $('reviewSelectionSummary').textContent = '已选择 ' + selectedCount + ' 条。' + (hasError ? ' blocked 不能发布，只能退回或不发布。' : '');
      $('acceptSelectedReviewButton').disabled = selectedCount === 0 || hasError || !hasWarn;
      $('requestEditsReviewButton').disabled = selectedCount === 0;
      $('rejectReviewButton').disabled = selectedCount === 0;
    }

    function needsReview(run, review) {
      const counters = run?.counters || {};
      return Boolean(review?.required || counters.pendingReviewSlices > 0 || counters.blockedSlices > 0);
    }

    function showDone() {
      $('reviewPanel').hidden = true;
      $('done').hidden = false;
    }

    function currentReviewQuery() {
      return {
        offset: state.reviewOffset,
        limit: state.reviewLimit,
        severity: $('reviewSeverity') ? $('reviewSeverity').value : 'all',
        search: $('reviewSearch') ? $('reviewSearch').value.trim() : ''
      };
    }

    async function submitSelectedReview(action) {
      const ids = Array.from(state.selectedReviewIds);
      if (ids.length === 0) return;
      if (action === 'accept_warnings') {
        const hasBlocked = Array.from(state.selectedReviewMeta.values()).some((item) => item.qualitySeverity === 'error');
        if (hasBlocked) {
          $('preflight').textContent = 'blocked 切片不能直接发布，请改用“退回修改”或“不发布选中”。';
          updateReviewButtons();
          return;
        }
      }
      const defaultNotes = action === 'accept_warnings'
        ? 'Dashboard reviewer accepted selected warning-quality slices for publish.'
        : action === 'request_edits'
          ? 'Dashboard reviewer requested edits for selected slices.'
          : 'Dashboard reviewer rejected selected slices.';
      const response = await fetch('/api/onboarding/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          reviewer: 'super-helper-dashboard',
          notes: $('reviewNotes').value || defaultNotes,
          ids,
          query: currentReviewQuery()
        })
      });
      const result = await response.json();
      $('preflight').textContent = JSON.stringify(result, null, 2);
      if (!response.ok) return;
      state.selectedReviewIds.clear();
      state.selectedReviewMeta.clear();
      renderReview(result.review);
      if (!result.review.required) {
        showDone();
        location.href = '/';
      }
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
    $('refreshReviewButton').addEventListener('click', refreshReview);
    $('selectReviewPageButton').addEventListener('click', selectCurrentReviewPage);
    $('clearReviewSelectionButton').addEventListener('click', clearReviewSelection);
    $('acceptSelectedReviewButton').addEventListener('click', () => submitSelectedReview('accept_warnings'));
    $('requestEditsReviewButton').addEventListener('click', () => submitSelectedReview('request_edits'));
    $('rejectReviewButton').addEventListener('click', () => submitSelectedReview('reject'));
    $('reviewPrevButton').addEventListener('click', () => {
      state.reviewOffset = Math.max(0, state.reviewOffset - state.reviewLimit);
      refreshReview();
    });
    $('reviewNextButton').addEventListener('click', () => {
      state.reviewOffset += state.reviewLimit;
      refreshReview();
    });
    $('reviewSeverity').addEventListener('change', () => refreshReview({ resetOffset: true }));
    $('reviewSearch').addEventListener('input', () => {
      if (state.reviewSearchTimer) clearTimeout(state.reviewSearchTimer);
      state.reviewSearchTimer = setTimeout(() => refreshReview({ resetOffset: true }), 250);
    });
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
