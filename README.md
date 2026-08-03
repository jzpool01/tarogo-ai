# TarogoAI SDK for Node.js

[![npm version](https://img.shields.io/npm/v/tarogo-ai.svg)](https://www.npmjs.com/package/tarogo-ai)
[![npm downloads](https://img.shields.io/npm/dm/tarogo-ai.svg)](https://www.npmjs.com/package/tarogo-ai)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

TarogoAI 官方 Node.js SDK —— **OpenAI 兼容**的 LLM 客户端，开箱即用，零依赖（仅基于原生 `fetch`）。

只需传入一个 API Key，默认请求 `https://api.tarogo.com`；也支持通过参数动态覆盖上游地址（可对接任意 OpenAI 兼容服务）。

## 特性

- ✅ **只需 API Key**：`new TarogoAI({ apiKey: 'xxx' })` 即可使用（也可用环境变量 `TAROGO_API_KEY`）
- ✅ **默认接入** `https://api.tarogo.com`，无需任何额外配置
- ✅ **OpenAI 兼容**：`chat.completions` / `completions` / `embeddings` / `models`，调用方式与官方 SDK 一致
- ✅ **参数覆盖地址**：构造参数 `baseURL`、请求级 `options.baseURL`、或请求体 `base_url` 均可覆盖上游地址（自动剥离，不污染请求）
- ✅ **流式输出**：`stream: true` 返回异步迭代器，逐块消费
- ✅ **完整错误体系**：401/403/404/429/5xx 映射为对应错误类型
- ✅ **TypeScript 类型声明**、CommonJS + ESM 双入口、零运行时依赖

## 安装

```bash
npm install tarogo-ai
```

## 快速开始

### CommonJS

```js
const TarogoAI = require('tarogo-ai');

const tarogo = new TarogoAI({ apiKey: '你的APIKey' }); // 默认 https://api.tarogo.com

async function main() {
  const completion = await tarogo.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are TarogoAI assistant.' },
      { role: 'user', content: '你好！请介绍一下你自己。' },
    ],
  });

  console.log(completion.choices[0].message.content);
}

main();
```

### ESM

```js
import TarogoAI from 'tarogo-ai';

const tarogo = new TarogoAI({ apiKey: process.env.TAROGO_API_KEY });
```

### TypeScript

```ts
import TarogoAI from 'tarogo-ai';

const tarogo = new TarogoAI({ apiKey: '你的APIKey' });
const completion = await tarogo.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

## API 参考

### 构造函数

```ts
new TarogoAI(options?: {
  apiKey?: string;          // API Key，或使用环境变量 TAROGO_API_KEY
  baseURL?: string;         // 上游地址，默认 'https://api.tarogo.com'（无需带 /v1）
  timeout?: number;         // 超时毫秒数，默认 600000（10 分钟）
  defaultHeaders?: object;  // 附加到每个请求的默认请求头
  fetch?: typeof fetch;     // 自定义 fetch 实现
})
```

### 对话补全（Chat Completions）

```js
const chat = await tarogo.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: '写一首诗' }],
  temperature: 0.7,
});
```

### 流式对话

```js
const stream = await tarogo.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: '数到 3' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

### 传统补全 / 向量化 / 模型列表

```js
const comp = await tarogo.completions.create({
  model: 'text-davinci-003',
  prompt: 'Say hello',
});

const emb = await tarogo.embeddings.create({
  model: 'text-embedding-3-small',
  input: 'Hello world',
});

const models = await tarogo.models.list();
const model = await tarogo.models.retrieve('gpt-4o');
```

### 任意 OpenAI 兼容接口（通用调用）

```js
const result = await tarogo.request('/v1/moderations', {
  model: 'text-moderation-latest',
  input: 'I want to kill them',
});
```

## 覆盖上游地址（三种方式，按优先级）

默认上游为 `https://api.tarogo.com`，可通过以下方式覆盖（高 → 低）：

| 优先级 | 方式 | 示例 |
| --- | --- | --- |
| 1 | 请求体 `base_url` | `create({ ..., base_url: 'https://x.com' })` |
| 2 | 请求级 `options.baseURL` | `create(params, { baseURL: 'https://x.com' })` |
| 3 | 构造参数 `baseURL` | `new TarogoAI({ baseURL: 'https://x.com' })` |

```js
// 方式 1：请求体参数覆盖（与 TarogoAI 服务端协议一致）
const res = await tarogo.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'hi' }],
  base_url: 'https://another-llm-provider.example.com',
});

// 方式 2：请求级 options 覆盖
const res2 = await tarogo.chat.completions.create(params, {
  baseURL: 'https://another-llm-provider.example.com',
});
```

> 覆盖地址的 `base_url` / `baseUrl` / `api_key` 字段会被 SDK 自动剥离，不会透传给上游。

## 错误处理

所有非 2xx 响应都会抛出对应类型的错误（均继承自 `TarogoAIError`）：

| 状态码 | 错误类型 |
| --- | --- |
| 400 / 413 / 422 | `BadRequestError` |
| 401 | `AuthenticationError` |
| 403 | `PermissionDeniedError` |
| 404 | `NotFoundError` |
| 429 | `RateLimitError` |
| 500 / 502 / 503 / 504 | `InternalServerError` |
| 网络错误 | `APIConnectionError` |

```js
const { TarogoAIError, RateLimitError } = require('tarogo-ai');

try {
  await tarogo.chat.completions.create({ model: 'gpt-4o', messages: [] });
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log('触发限流，请稍后重试:', err.message);
  } else if (err instanceof TarogoAIError) {
    console.log(`请求失败 [${err.status}]:`, err.message);
  }
}
```

## 超时与取消

```js
// 单次请求覆盖超时时间
await tarogo.chat.completions.create(params, { timeout: 30_000 });

// 使用 AbortSignal 取消
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);
await tarogo.chat.completions.create(params, { signal: controller.signal });
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `TAROGO_API_KEY` | 默认 API Key（构造时未传 `apiKey` 时使用） |

## 运行测试

```bash
npm install
npm test
```

## 发布到 npm

```bash
npm login              # 登录 npm 账号
npm publish            # 发布（自动先运行 prepublishOnly 测试）
```

仓库已配置 GitHub Actions 自动发布：

```bash
# 方式一：手动发布（本地）
npm login              # 登录 npm 账号
npm publish            # 发布（自动先运行 prepublishOnly 测试）

# 方式二：GitHub Actions 自动发布（推荐）
git tag v1.0.1         # 打版本 tag
git push origin v1.0.1 # push 后自动：测试 → npm publish
```

### GitHub 配置要求

1. 将代码推送到 GitHub 仓库（Actions 需要代码在 GitHub 上才能运行）
2. 在仓库 **Settings → Secrets and variables → Actions** 添加 `NPM_TOKEN`
   （npm 账号生成方式：`npm token create --read-only` 生成自动化 token）
3. 确认 `package.json` 中 `repository` / `bugs` 字段为真实仓库地址

### 发布内容

发布内容由 `package.json` 的 `files` 白名单控制（`src/`、`types/`、`README.md`、`LICENSE`），不含测试与内部服务代码。

## 目录结构

```
.
├── src/                 # SDK 源码（发布）
│   ├── index.js         # CommonJS 入口
│   ├── index.mjs        # ESM 入口
│   ├── client.js        # TarogoAI 客户端核心
│   ├── errors.js        # 错误类型
│   └── stream.js        # SSE 流式解析
├── types/index.d.ts     # TypeScript 类型声明（发布）
├── test/sdk.test.js     # SDK 测试
├── server/              # 内部代理服务（部署 api.tarogo.com 用，不随包发布）
│   ├── server.js
│   ├── app.js
│   ├── proxy.js
│   ├── config.js
│   └── test/
├── LICENSE
└── package.json
```

## License

MIT