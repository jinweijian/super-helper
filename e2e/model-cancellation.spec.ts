import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../dist/config.js';
import { startServer } from '../dist/gateway/http-server.js';

test('真实页面停止模型正文读取且只生成一次取消回复', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'model-stop-e2e-'));
  let calls = 0;
  let closed = false;
  const model = createServer((_req, res) => {
    calls++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.flushHeaders();
    // 不发送正文；只有取消或测试清理才能关闭连接。
    res.on('close', () => { closed = true; });
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const address = model.address();
  if (!address || typeof address === 'string') throw new Error('fixture address unavailable');
  const config = defaultConfig();
  config.server.host = '127.0.0.1';
  config.server.port = 0;
  config.storage.rootDir = root;
  config.knowledge.rootDir = join(root, 'knowledge');
  config.onboarding.completedAt = new Date().toISOString();
  config.agent.useModelForPreflight = true;
  config.agent.modelProvider = 'cancel-fixture';
  config.models.providers['cancel-fixture'] = { type: 'openai-compatible', model: 'fixture',
    baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'synthetic-key', timeoutMs: 60000 };
  let workerCalls = 0;
  const server = await startServer({ config, workerFactory: () => ({ async diagnose() {
    workerCalls++; throw new Error('unexpected worker');
  } }) });
  try {
    await page.goto(server.url);
    await page.getByLabel('输入问题', { exact: true }).fill('检查当前项目入口代码');
    const accepted = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/chat');
    await page.getByRole('button', { name: /^发送/ }).click();
    const turn = await (await accepted).json();
    await expect.poll(() => calls).toBe(1);
    const cancelled = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/chat/cancel');
    await page.getByRole('button', { name: '停止排查', exact: true }).click();
    expect((await cancelled).status()).toBe(202);
    await expect.poll(() => closed).toBe(true);
    await expect(page.getByRole('button', { name: '一键重试', exact: true })).toBeVisible();
    const session = (await (await page.request.get(`${server.url}/api/session?caseId=${turn.caseId}&includeKnowledgeHealth=false`)).json()).session;
    const replies = session.messages.filter((m: { role: string; replyToMessageId?: string }) => m.role === 'helper' && m.replyToMessageId === turn.userMessageId);
    expect(replies).toHaveLength(1);
    expect(replies[0].body).toContain('排查已停止');
    expect(workerCalls).toBe(0);
    expect(calls).toBe(1);
  } finally {
    await page.close();
    model.closeAllConnections();
    await new Promise<void>(resolve => model.close(() => resolve()));
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
