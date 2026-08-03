'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

const { createApp } = require('../app');
const { cleanBody, extractApiKey, buildTargetUrl } = require('../proxy');

const state = { requests: [] };

/** 启动一个模拟的上游 OpenAI 兼容服务 */
function startMockUpstream() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      state.requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        body: raw,
      });

      let parsed = {};
      try {
        parsed = JSON.parse(raw || '{}');
      } catch {
        // ignore
      }

      // SSE 流式
      if (parsed.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"id":"chatcmpl-mock","choices":[{"delta":{"content":"Hello"}}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // models 列表
      if (req.url.startsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }));
        return;
      }

      // 上游错误
      if (req.url.startsWith('/v1/fail')) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'upstream boom', type: 'server_error' } }));
        return;
      }

      // 普通 chat completion
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-mock',
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

/** 启动代理应用，返回 baseUrl 与 server */
async function startProxy(options) {
  const app = createApp(options);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function startMock() {
  const server = startMockUpstream();
  await once(server, 'listening');
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

function stop(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ---------- 单元测试 ----------

test('cleanBody 剥离自定义字段', () => {
  assert.deepEqual(cleanBody({ base_url: 'x', baseUrl: 'y', api_key: 'z', model: 'gpt' }), {
    model: 'gpt',
  });
  assert.equal(cleanBody(null), null);
});

test('buildTargetUrl 拼接路径与查询参数', () => {
  const req = { url: '/v1/chat/completions?model=gpt' };
  assert.equal(
    buildTargetUrl(req, 'https://api.tarogo.com').href,
    'https://api.tarogo.com/v1/chat/completions?model=gpt'
  );
  assert.throws(() => buildTargetUrl(req, 'not-a-url'));
});

// ---------- 集成测试 ----------

test('转发 chat/completions 到默认上游', async (t) => {
  const mock = await startMock();
  const proxy = await startProxy({ defaultBaseUrl: mock.url });
  t.after(async () => {
    await stop(mock.server);
    await stop(proxy.server);
  });

  const res = await fetch(`${proxy.url}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test-123',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      api_key: 'should-be-stripped',
    }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.choices[0].message.content, 'pong');

  const upstream = state.requests.at(-1);
  assert.equal(upstream.url, '/v1/chat/completions');
  assert.equal(upstream.authorization, 'Bearer sk-test-123');
  const sent = JSON.parse(upstream.body);
  assert.equal(sent.model, 'gpt-4o');
  assert.equal(sent.api_key, undefined, 'api_key 不应透传给上游');
});

test('body.base_url 覆盖默认上游地址', async (t) => {
  const mock = await startMock();
  // 默认上游故意指向不可达端口，若未覆盖则必然失败
  const proxy = await startProxy({ defaultBaseUrl: 'http://127.0.0.1:1' });
  t.after(async () => {
    await stop(mock.server);
    await stop(proxy.server);
  });

  const res = await fetch(`${proxy.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      api_key: 'sk-in-body',
      base_url: mock.url,
    }),
  });

  assert.equal(res.status, 200);
  const upstream = state.requests.at(-1);
  assert.equal(upstream.url, '/v1/chat/completions');
  assert.equal(upstream.authorization, 'Bearer sk-in-body', 'body 中的 api_key 应转为 Bearer 透传');
  const sent = JSON.parse(upstream.body);
  assert.equal(sent.base_url, undefined, 'base_url 不应透传给上游');
});

test('X-Base-URL 请求头覆盖默认上游地址', async (t) => {
  const mock = await startMock();
  const proxy = await startProxy({ defaultBaseUrl: 'http://127.0.0.1:1' });
  t.after(async () => {
    await stop(mock.server);
    await stop(proxy.server);
  });

  const res = await fetch(`${proxy.url}/v1/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-header',
      'X-Base-URL': mock.url,
    },
    body: JSON.stringify({ model: 'text-davinci-003', prompt: 'hi' }),
  });

  assert.equal(res.status, 200);
  const upstream = state.requests.at(-1);
  assert.equal(upstream.url, '/v1/completions');
  assert.equal(upstream.authorization, 'Bearer sk-header');
});

test('缺少 API Key 返回 401', async (t) => {
  const proxy = await startProxy();
  t.after(() => stop(proxy.server));

  const res = await fetch(`${proxy.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
  });

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.ok(data.error.message.includes('API Key'));
});

test('SSE 流式响应透传', async (t) => {
  const mock = await startMock();
  const proxy = await startProxy({ defaultBaseUrl: mock.url });
  t.after(async () => {
    await stop(mock.server);
    await stop(proxy.server);
  });

  const res = await fetch(`${proxy.url}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-stream',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    }),
  });

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const text = await res.text();
  assert.match(text, /"content":"Hello"/);
  assert.match(text, /\[DONE\]/);
});

test('GET /v1/models 透传', async (t) => {
  const mock = await startMock();
  const proxy = await startProxy({ defaultBaseUrl: mock.url });
  t.after(async () => {
    await stop(mock.server);
    await stop(proxy.server);
  });

  const res = await fetch(`${proxy.url}/v1/models`, {
    headers: { Authorization: 'Bearer sk-models' },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.data[0].id, 'mock-model');
  assert.equal(state.requests.at(-1).authorization, 'Bearer sk-models');
});

test('上游错误响应原样转发', async (t) => {
  const mock = await startMock();
  const proxy = await startProxy({ defaultBaseUrl: mock.url });
  t.after(async () => {
    await stop(mock.server);
    await stop(proxy.server);
  });

  const res = await fetch(`${proxy.url}/v1/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk' },
    body: JSON.stringify({ model: 'gpt-4o' }),
  });
  assert.equal(res.status, 500);
  const data = await res.json();
  assert.equal(data.error.message, 'upstream boom');
});

test('无效 base_url 返回 400', async (t) => {
  const proxy = await startProxy();
  t.after(() => stop(proxy.server));

  const res = await fetch(`${proxy.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk' },
    body: JSON.stringify({ model: 'gpt-4o', base_url: 'not-a-url' }),
  });
  assert.equal(res.status, 400);
});

test('上游不可达返回 502', async (t) => {
  const proxy = await startProxy({ defaultBaseUrl: 'http://127.0.0.1:1' });
  t.after(() => stop(proxy.server));

  const res = await fetch(`${proxy.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk' },
    body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
  });
  assert.equal(res.status, 502);
});

test('health 检查', async (t) => {
  const proxy = await startProxy({ defaultBaseUrl: 'https://api.tarogo.com' });
  t.after(() => stop(proxy.server));

  const res = await fetch(`${proxy.url}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.name, 'TarogoAI');
  assert.equal(data.defaultBaseUrl, 'https://api.tarogo.com');
});