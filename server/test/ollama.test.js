'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

const { createApp } = require('../app');
const { OllamaClient } = require('../ollama');

const state = {
  ollamaRequests: [],
  upstreamRequests: [],
  tagsCount: 0,
};

/** 每个测试前重置跨测试共享状态 */
function resetState() {
  state.ollamaRequests.length = 0;
  state.upstreamRequests.length = 0;
  state.tagsCount = 0;
}

/** 模拟本地 Ollama 服务（/api/ps + OpenAI 兼容 /v1/*） */
function startMockOllama() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      state.ollamaRequests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      });

      if (req.url === '/api/ps' && req.method === 'GET') {
        state.tagsCount += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            models: [{ name: 'llama3:8b' }, { name: 'qwen2.5:7b' }],
          })
        );
        return;
      }

      if (req.url.startsWith('/v1/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'ollama-mock',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'local-pong' },
                finish_reason: 'stop',
              },
            ],
          })
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });
  server.listen(0, '127.0.0.1');
  return server;
}

/** 模拟默认上游服务 */
function startMockUpstream() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      state.upstreamRequests.push({
        method: req.method,
        url: req.url,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'upstream-mock',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'pong' },
              finish_reason: 'stop',
            },
          ],
        })
      );
    });
  });
  server.listen(0, '127.0.0.1');
  return server;
}

async function start(server) {
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function stop(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function chat(proxyUrl, body) {
  return fetch(`${proxyUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' },
    body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], ...body }),
  });
}

test('本地存在该模型时直接路由到 Ollama（精确匹配）', async (t) => {
  resetState();
  const ollama = await start(startMockOllama());
  const upstream = await start(startMockUpstream());
  const proxy = await start(
    createApp({ defaultBaseUrl: upstream.url, ollamaHost: ollama.url }).listen(0, '127.0.0.1')
  );
  t.after(async () => {
    await stop(ollama.server);
    await stop(upstream.server);
    await stop(proxy.server);
  });

  const res = await chat(proxy.url, { model: 'llama3:8b' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.choices[0].message.content, 'local-pong');
  assert.equal(res.headers.get('x-tarogo-ollama'), 'llama3:8b');

  const req = state.ollamaRequests.at(-1);
  assert.equal(req.url, '/v1/chat/completions');
  assert.equal(req.authorization, 'Bearer sk-test');
  assert.equal(state.upstreamRequests.length, 0, '不应请求默认上游');
});

test('省略 tag 的模型名也能命中本地（llama3 → llama3:8b）', async (t) => {
  resetState();
  const ollama = await start(startMockOllama());
  const upstream = await start(startMockUpstream());
  const proxy = await start(
    createApp({ defaultBaseUrl: upstream.url, ollamaHost: ollama.url }).listen(0, '127.0.0.1')
  );
  t.after(async () => {
    await stop(ollama.server);
    await stop(upstream.server);
    await stop(proxy.server);
  });

  const res = await chat(proxy.url, { model: 'llama3' });
  assert.equal((await res.json()).choices[0].message.content, 'local-pong');
  assert.equal(state.upstreamRequests.length, 0);
});

test('本地无该模型时走默认上游', async (t) => {
  resetState();
  const ollama = await start(startMockOllama());
  const upstream = await start(startMockUpstream());
  const proxy = await start(
    createApp({ defaultBaseUrl: upstream.url, ollamaHost: ollama.url }).listen(0, '127.0.0.1')
  );
  t.after(async () => {
    await stop(ollama.server);
    await stop(upstream.server);
    await stop(proxy.server);
  });

  const res = await chat(proxy.url, { model: 'gpt-4o' });
  assert.equal((await res.json()).choices[0].message.content, 'pong');
  assert.equal(state.ollamaRequests.filter((r) => r.url === '/v1/chat/completions').length, 0);
});

test('Ollama 不可达时静默降级到默认上游', async (t) => {
  resetState();
  const upstream = await start(startMockUpstream());
  const proxy = await start(
    createApp({
      defaultBaseUrl: upstream.url,
      ollamaHost: 'http://127.0.0.1:1', // 不可达端口
      ollamaTimeout: 200,
    }).listen(0, '127.0.0.1')
  );
  t.after(async () => {
    await stop(upstream.server);
    await stop(proxy.server);
  });

  const res = await chat(proxy.url, { model: 'llama3:8b' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).choices[0].message.content, 'pong');
  assert.equal(state.upstreamRequests.at(-1).url, '/v1/chat/completions');
});

test('显式 base_url 优先于本地路由', async (t) => {
  resetState();
  const ollama = await start(startMockOllama());
  const upstream = await start(startMockUpstream());
  const proxy = await start(
    createApp({ defaultBaseUrl: 'http://127.0.0.1:1', ollamaHost: ollama.url }).listen(0, '127.0.0.1')
  );
  t.after(async () => {
    await stop(ollama.server);
    await stop(upstream.server);
    await stop(proxy.server);
  });

  // 本地有 llama3:8b，但显式指定 base_url → 应走显式地址
  const res = await chat(proxy.url, { model: 'llama3:8b', base_url: upstream.url });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).choices[0].message.content, 'pong');
  assert.equal(state.upstreamRequests.length, 1);
  assert.equal(state.ollamaRequests.filter((r) => r.url === '/v1/chat/completions').length, 0);
});

test('OLLAMA_ENABLED=false 时即使本地有模型也走默认上游', async (t) => {
  resetState();
  const ollama = await start(startMockOllama());
  const upstream = await start(startMockUpstream());
  const proxy = await start(
    createApp({
      defaultBaseUrl: upstream.url,
      ollamaHost: ollama.url,
      ollamaEnabled: false,
    }).listen(0, '127.0.0.1')
  );
  t.after(async () => {
    await stop(ollama.server);
    await stop(upstream.server);
    await stop(proxy.server);
  });

  const res = await chat(proxy.url, { model: 'llama3:8b' });
  assert.equal((await res.json()).choices[0].message.content, 'pong');
  assert.equal(state.ollamaRequests.filter((r) => r.url === '/v1/chat/completions').length, 0);
});

test('/health 返回 Ollama 状态与本地模型清单', async (t) => {
  resetState();
  const ollama = await start(startMockOllama());
  const proxy = await start(
    createApp({ ollamaHost: ollama.url }).listen(0, '127.0.0.1')
  );
  t.after(async () => {
    await stop(ollama.server);
    await stop(proxy.server);
  });

  const res = await fetch(`${proxy.url}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ollama.available, true);
  assert.ok(data.ollama.models.includes('llama3:8b'));
  assert.ok(data.ollama.models.includes('qwen2.5:7b'));
});

test('模型清单带 TTL 缓存：多次探测只请求一次 /api/ps', async (t) => {
  resetState();
  const ollama = await start(startMockOllama());
  const client = new OllamaClient({
    host: ollama.url,
    cacheTTL: 10000,
    timeout: 500,
  });
  t.after(() => stop(ollama.server));

  await client.hasModel('llama3:8b');
  await client.hasModel('qwen2.5:7b');
  await client.isAvailable();
  assert.equal(state.tagsCount, 1, '/api/ps 应只被请求一次');
});