'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

const TarogoAI = require('../src/index.js');
const { normalizeBaseURL } = require('../src/client');

const state = { requests: [] };

function resetState() {
  state.requests.length = 0;
}

/** 模拟 OpenAI 兼容上游服务 */
function startMock() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      state.requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: raw,
      });

      let parsed = {};
      try {
        parsed = JSON.parse(raw || '{}');
      } catch {
        // ignore
      }

      // Ollama 已安装模型清单（本地路由探测用）
      if (req.url === '/api/tags' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'llama3:8b' }, { name: 'qwen2.5:7b' }] }));
        return;
      }

      // 401 场景
      if (req.url.startsWith('/v1/unauthorized')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'invalid_request_error' } }));
        return;
      }

      // SSE 流式
      if (parsed.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant"}}]}\n\n');
        res.write('data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}\n\n');
        res.write('data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"}}]}\n\n');
        res.write('data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (req.url.startsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }));
        return;
      }

      if (req.url.startsWith('/v1/embeddings')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
            model: 'mock-embedding',
            usage: { prompt_tokens: 1, total_tokens: 1 },
          })
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1,
          model: parsed.model || 'mock',
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

async function startMockServer() {
  const server = startMock();
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function stop(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ---------- 基础行为 ----------

test('默认 baseURL 为 https://api.tarogo.com 且自动归一化', () => {
  const client = new TarogoAI({ apiKey: 'sk-test' });
  assert.equal(client.baseURL, 'https://api.tarogo.com');

  const withV1 = new TarogoAI({ apiKey: 'sk-test', baseURL: 'https://api.tarogo.com/v1' });
  assert.equal(withV1.baseURL, 'https://api.tarogo.com');
  assert.equal(normalizeBaseURL('https://x.com///'), 'https://x.com');
});

test('缺少 API Key 时抛出 AuthenticationError', async () => {
  const client = new TarogoAI();
  await assert.rejects(
    () => client.chat.completions.create({ model: 'gpt-4o', messages: [] }),
    (err) => err instanceof TarogoAI.AuthenticationError
  );
});

// ---------- 本地 Ollama 自动路由 ----------

test('本地 Ollama 有该模型时自动路由到本地', async (t) => {
  resetState();
  const ollama = await startMockServer();
  // 默认上游故意指向不可达端口：若未路由到本地则必然失败
  const client = new TarogoAI({
    apiKey: 'sk-test',
    baseURL: 'http://127.0.0.1:1',
    ollama: { host: ollama.url, cacheTTL: 10000, timeout: 500 },
  });
  t.after(() => stop(ollama.server));

  const res = await client.chat.completions.create({
    model: 'llama3:8b',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(res.choices[0].message.content, 'pong');
  const req = state.requests.at(-1);
  assert.equal(req.url, '/v1/chat/completions');
  assert.equal(req.authorization, 'Bearer sk-test');
});

test('routeOf 返回实际路由信息（本地命中）', async (t) => {
  resetState();
  const ollama = await startMockServer();
  const client = new TarogoAI({
    apiKey: 'sk-test',
    baseURL: 'http://127.0.0.1:1',
    ollama: { host: ollama.url, cacheTTL: 10000, timeout: 500 },
  });
  t.after(() => stop(ollama.server));

  const res = await client.chat.completions.create({
    model: 'llama3:8b',
    messages: [{ role: 'user', content: 'hi' }],
  });
  const route = TarogoAI.routeOf(res);
  assert.ok(route, '应能读取路由信息');
  assert.equal(route.local, true);
  assert.equal(route.baseURL, ollama.url);
  // 路由信息应为非枚举属性，不污染 JSON 序列化
  assert.deepEqual(
    Object.keys(res).sort(),
    ['choices', 'id', 'object', 'created', 'model'].sort()
  );
});

test('routeOf 返回实际路由信息（云端回落）', async (t) => {
  resetState();
  const upstream = await startMockServer();
  const client = new TarogoAI({
    apiKey: 'sk-test',
    baseURL: upstream.url,
    ollama: { host: 'http://127.0.0.1:1', timeout: 200 },
  });
  t.after(() => stop(upstream.server));

  const res = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
  });
  const route = TarogoAI.routeOf(res);
  assert.ok(route);
  assert.equal(route.local, false);
  assert.equal(route.baseURL, upstream.url);
});

test('本地 Ollama 无该模型时回落默认上游', async (t) => {
  resetState();
  const ollama = await startMockServer();
  const upstream = await startMockServer();
  const client = new TarogoAI({
    apiKey: 'sk-test',
    baseURL: upstream.url,
    ollama: { host: ollama.url, cacheTTL: 10000, timeout: 500 },
  });
  t.after(async () => {
    await stop(ollama.server);
    await stop(upstream.server);
  });

  const res = await client.chat.completions.create({
    model: 'gpt-4o', // 本地清单里没有
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(res.choices[0].message.content, 'pong');
  assert.equal(state.requests.at(-1).url, '/v1/chat/completions');
});

test('ollama: false 关闭本地路由', async (t) => {
  resetState();
  const ollama = await startMockServer();
  const upstream = await startMockServer();
  const client = new TarogoAI({
    apiKey: 'sk-test',
    baseURL: upstream.url,
    ollama: false, // 关闭本地路由
  });
  t.after(async () => {
    await stop(ollama.server);
    await stop(upstream.server);
  });

  const res = await client.chat.completions.create({
    model: 'llama3:8b', // 本地清单有，但路由已关闭
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(res.choices[0].message.content, 'pong');
  assert.equal(state.requests.at(-1).url, '/v1/chat/completions');
});

test('省略 tag 的模型名命中本地（llama3 → llama3:8b）', async (t) => {
  resetState();
  const ollama = await startMockServer();
  const client = new TarogoAI({
    apiKey: 'sk-test',
    baseURL: 'http://127.0.0.1:1',
    ollama: { host: ollama.url, cacheTTL: 10000, timeout: 500 },
  });
  t.after(() => stop(ollama.server));

  const res = await client.chat.completions.create({
    model: 'llama3',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(res.choices[0].message.content, 'pong');
});

// ---------- 请求与转发 ----------

test('chat.completions.create 正确发送请求并剥离自定义字段', async (t) => {
  const mock = await startMockServer();
  const client = new TarogoAI({ apiKey: 'sk-test', baseURL: mock.url });
  t.after(() => stop(mock.server));

  const res = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
    api_key: 'should-be-stripped',
  });

  assert.equal(res.choices[0].message.content, 'pong');
  const req = state.requests.at(-1);
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/v1/chat/completions');
  assert.equal(req.authorization, 'Bearer sk-test');
  const sent = JSON.parse(req.body);
  assert.equal(sent.model, 'gpt-4o');
  assert.equal(sent.base_url, undefined);
  assert.equal(sent.api_key, undefined);
});

test('body.base_url 覆盖上游地址且剥离透传', async (t) => {
  const mock = await startMockServer();
  // 默认地址故意指向不可达端口
  const client = new TarogoAI({ apiKey: 'sk-test', baseURL: 'http://127.0.0.1:1' });
  t.after(() => stop(mock.server));

  const res = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
    base_url: mock.url,
  });
  assert.equal(res.choices[0].message.content, 'pong');
  const req = state.requests.at(-1);
  assert.equal(req.authorization, 'Bearer sk-test');
  const sent = JSON.parse(req.body);
  assert.equal(sent.base_url, undefined, 'base_url 不应透传给上游');
});

test('requestOptions.baseURL 覆盖上游地址', async (t) => {
  const mock = await startMockServer();
  const client = new TarogoAI({ apiKey: 'sk-test', baseURL: 'http://127.0.0.1:1' });
  t.after(() => stop(mock.server));

  const res = await client.chat.completions.create(
    { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    { baseURL: mock.url }
  );
  assert.equal(res.choices[0].message.content, 'pong');
});

test('流式输出：异步迭代逐块返回', async (t) => {
  const mock = await startMockServer();
  const client = new TarogoAI({ apiKey: 'sk-test', baseURL: mock.url });
  t.after(() => stop(mock.server));

  const stream = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  const content = chunks
    .map((c) => (c.choices && c.choices[0] ? c.choices[0].delta?.content : ''))
    .filter(Boolean)
    .join('');
  assert.equal(content, 'Hello world');
  assert.equal(chunks.at(-1).choices[0].finish_reason, 'stop');
});

test('非 2xx 抛出对应错误类型', async (t) => {
  const mock = await startMockServer();
  const client = new TarogoAI({ apiKey: 'sk-test', baseURL: mock.url });
  t.after(() => stop(mock.server));

  await assert.rejects(
    () => client.request('/v1/unauthorized', { model: 'x' }),
    (err) => {
      assert.ok(err instanceof TarogoAI.AuthenticationError);
      assert.equal(err.status, 401);
      assert.equal(err.message, 'Invalid API key');
      return true;
    }
  );
});

test('models.list 使用 GET 请求', async (t) => {
  const mock = await startMockServer();
  const client = new TarogoAI({ apiKey: 'sk-test', baseURL: mock.url });
  t.after(() => stop(mock.server));

  const list = await client.models.list();
  assert.equal(list.data[0].id, 'mock-model');
  const req = state.requests.at(-1);
  assert.equal(req.method, 'GET');
  assert.equal(req.url, '/v1/models');
});

test('embeddings.create 可用', async (t) => {
  const mock = await startMockServer();
  const client = new TarogoAI({ apiKey: 'sk-test', baseURL: mock.url });
  t.after(() => stop(mock.server));

  const emb = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: 'hello',
  });
  assert.deepEqual(emb.data[0].embedding, [0.1, 0.2, 0.3]);
});

test('请求超时抛错', async (t) => {
  const client = new TarogoAI({ apiKey: 'sk-test', baseURL: 'http://10.255.255.1', timeout: 50 });
  await assert.rejects(
    () => client.chat.completions.create({ model: 'gpt-4o', messages: [] }),
    (err) => {
      assert.ok(err instanceof TarogoAI.TarogoAIError);
      assert.match(err.message, /超时/);
      return true;
    }
  );
});