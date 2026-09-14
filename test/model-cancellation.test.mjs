import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createModelClient } from '../dist/providers/model/adapter.js';

const messages = [{ role: 'user', content: '本地合成输入' }];
const payload = JSON.stringify({ choices: [{ message: { content: 'ok' } }] });

async function localServer(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function client(baseUrl, timeoutMs = 500) {
  return createModelClient({ type: 'openai-compatible', baseUrl, model: 'fixture', apiKey: 'synthetic-key', timeoutMs });
}

test('model timeout covers a delayed response body after headers arrive', async (t) => {
  let headersSent = false;
  const url = await localServer(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.flushHeaders();
    headersSent = true;
    const timer = setTimeout(() => res.end(payload), 300);
    res.on('close', () => clearTimeout(timer));
  });
  await assert.rejects(client(url, 100).complete(messages), /Model request timed out after 100ms/);
  assert.equal(headersSent, true);
});

test('pre-cancelled model request never reaches HTTP server or exposes abort reason', async (t) => {
  let requests = 0;
  const url = await localServer(t, (_req, res) => { requests++; res.end(payload); });
  const controller = new AbortController();
  controller.abort(new Error('synthetic-secret https://private.test/'));
  await assert.rejects(client(url).complete(messages, { signal: controller.signal }), (error) => {
    assert.equal(error.message, 'Model request cancelled');
    return true;
  });
  assert.equal(requests, 0);
});

test('cancellation during response reading closes request and removes listener', async (t) => {
  const controller = new AbortController();
  const adds = t.mock.method(controller.signal, 'addEventListener');
  const removes = t.mock.method(controller.signal, 'removeEventListener');
  let didClose;
  const closed = new Promise((resolve) => { didClose = resolve; });
  const url = await localServer(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"choices":');
    const timer = setTimeout(() => res.end('[]}'), 300);
    res.on('close', () => { clearTimeout(timer); didClose(); });
    setTimeout(() => controller.abort('synthetic-secret'), 20);
  });
  await assert.rejects(client(url).complete(messages, { signal: controller.signal }), /Model request cancelled/);
  await closed;
  assert.equal(adds.mock.callCount(), 1);
  assert.equal(removes.mock.callCount(), 1);
  assert.equal(adds.mock.calls[0].arguments[1], removes.mock.calls[0].arguments[1]);
});

test('successful model request cleans timeout and external listener', async (t) => {
  const controller = new AbortController();
  const removes = t.mock.method(controller.signal, 'removeEventListener');
  const originalFetch = globalThis.fetch;
  let requestSignal;
  t.mock.method(globalThis, 'fetch', (url, init) => {
    requestSignal = init.signal;
    return originalFetch(url, init);
  });
  const url = await localServer(t, (_req, res) => res.end(payload));
  assert.equal(await client(url, 100).complete(messages, { signal: controller.signal }), 'ok');
  await delay(120);
  controller.abort();
  assert.equal(requestSignal.aborted, false);
  assert.equal(removes.mock.callCount(), 1);
});

test('model errors do not reveal provider bodies, malformed payloads or URL credentials', async (t) => {
  const secret = 'synthetic-sensitive-marker';
  const url = await localServer(t, (req, res) => {
    if (req.url.startsWith('/status')) res.writeHead(429);
    res.end(`${secret} https://private.test/?key=${secret}`);
  });
  for (const [path, expected] of [['/status', 'Model request failed: 429'], ['/invalid', 'Model response was not valid JSON']]) {
    await assert.rejects(client(url + path).complete(messages), (error) => {
      assert.equal(error.message, expected);
      assert.doesNotMatch(String(error.stack), /synthetic-sensitive-marker|private.test/);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  await assert.rejects(client(`http://user:${secret}@127.0.0.1:1`).complete(messages), (error) => {
    assert.equal(error.message, 'Model request failed due to a network error');
    assert.doesNotMatch(String(error.stack), /synthetic-sensitive-marker/);
    return true;
  });
});

test('model safe errors expose bounded retry categories and clean failed-request listeners', async (t) => {
  const url = await localServer(t, (req, res) => {
    const status = Number(req.url.split('/')[1]);
    res.writeHead(status);
    res.end('synthetic error body');
  });
  for (const status of [400, 401, 429, 503]) {
    const controller = new AbortController();
    const removes = t.mock.method(controller.signal, 'removeEventListener');
    await assert.rejects(client(`${url}/${status}`).complete(messages, { signal: controller.signal }), (error) => {
      assert.equal(error.code, 'http_error');
      assert.equal(error.status, status);
      assert.equal(error.retryable, status === 429 || status === 503);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(removes.mock.callCount(), 1);
  }
});

test('cancelling while waiting for headers is not reported as timeout', async (t) => {
  const controller = new AbortController();
  const url = await localServer(t, (_req, res) => {
    const timer = setTimeout(() => res.end(payload), 300);
    res.on('close', () => clearTimeout(timer));
    controller.abort();
  });
  await assert.rejects(client(url).complete(messages, { signal: controller.signal }), (error) => {
    assert.equal(error.code, 'cancelled');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('model default request timeout remains 60000ms and its timer is cleared', async (t) => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let timer;
  let cleared = false;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    const result = originalSetTimeout(fn, ms, ...args);
    if (ms === 60_000) timer = result;
    return result;
  });
  t.mock.method(globalThis, 'clearTimeout', (value) => {
    if (value === timer) cleared = true;
    originalClearTimeout(value);
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(payload));
  const model = createModelClient({ type: 'openai-compatible', baseUrl: 'http://local.invalid', model: 'fixture', apiKey: 'synthetic-key' });
  assert.equal(await model.complete(messages), 'ok');
  assert.ok(timer);
  assert.equal(cleared, true);
});

test('network cause diagnostics allow only known codes and never stringify attacker content', async (t) => {
  const secret = 'synthetic-private-marker';
  for (const causeCode of ['ECONNRESET', `${secret} https://private.invalid`, { toString() { throw new Error(secret); } }]) {
    t.mock.method(globalThis, 'fetch', async () => {
      throw Object.assign(new TypeError(`fetch failed ${secret}`), {
        cause: Object.assign(new Error(`Authorization: Bearer ${secret}`), { code: causeCode }),
      });
    });
    await assert.rejects(client('https://local.invalid').complete(messages), (error) => {
      assert.equal(error.code, 'network_error');
      assert.equal(error.networkCode, causeCode === 'ECONNRESET' ? 'ECONNRESET' : undefined);
      assert.equal(error.message, 'Model request failed due to a network error' + (causeCode === 'ECONNRESET' ? ' (ECONNRESET)' : ''));
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(error.stack + JSON.stringify(error), /synthetic-private-marker|private\.invalid|Authorization/);
      return true;
    });
  }
});
