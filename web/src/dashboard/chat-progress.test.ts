import { describe, expect, it } from 'vitest';
import { progressView } from './chat-progress';

describe('问答进度模型', () => {
  it('映射阶段、耗时、心跳和估计范围', () => {
    const view = progressView({ state: 'running', startedAt: 1_000, lastActivityAt: 55_000, session: { status: 'diagnosing', agentActivity: [{ phase: 'knowledge_search_started', summary: '正在检索知识' }] } }, 61_000);
    expect(view.title).toContain('检索');
    expect(view.elapsedLabel).toBe('已耗时 1 分钟');
    expect(view.heartbeatLabel).toBe('6 秒前有活动');
    expect(view.estimateLabel).toContain('估计');
    expect(view.animated).toBe(true);
  });

  it('中断时停止动画并展示错误', () => {
    const view = progressView({ state: 'interrupted', startedAt: 1_000, lastActivityAt: 2_000, error: '连接已中断' }, 10_000);
    expect(view.title).toBe('回答已中断');
    expect(view.summary).toContain('连接已中断');
    expect(view.animated).toBe(false);
  });

  it.each([
    ['historical_case_search_started', '查询工单'],
    ['historical_case_analysis_started', '分析案例'],
    ['current_project_verification_started', '验证当前项目'],
    ['historical_cross_review_started', '交叉审核'],
  ])('把案例调查阶段 %s 显示为 %s', (phase, title) => {
    const view = progressView({
      state: 'running', startedAt: 1_000, lastActivityAt: 2_000,
      session: { status: 'diagnosing', agentActivity: [{ phase, summary: title }] },
    }, 3_000);
    expect(view.title).toContain(title);
    expect(view.steps).toContain(title);
  });
});
