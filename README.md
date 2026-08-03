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

默认上游为 `https://api.tarogo.com`，**baseURL 无需填写**。SDK 会自动路由（高 → 低）：

| 优先级 | 方式 | 示例 |
| --- | --- | --- |
| 1 | 请求体 `base_url` | `create({ ..., base_url: 'https://x.com' })` |
| 2 | 请求级 `options.baseURL` | `create(params, { baseURL: 'https://x.com' })` |
| 3 | **本地 Ollama 自动路由** | 模型在本地清单中时自动走 `localhost:11434` |
| 4 | 默认地址 | `https://api.tarogo.com` |

## 本地 Ollama 自动路由（默认开启）

SDK 内置本地模型优先策略：

- 请求时自动探测本地 Ollama（`http://localhost:11434`，通过 `GET /api/tags` 检测**已安装**的模型，带缓存，失败静默回落）
- **请求的模型在本地已安装清单中**（支持省略 tag，如 `llama3` 命中 `llama3:8b`）→ 自动改走本地（Ollama 自动加载），零 API 费用、低延迟
- 本地服务未启动 / 无该模型 → 自动回落默认上游 `https://api.tarogo.com`
- 关闭方式：`new TarogoAI({ ollama: false })` 或 `{ ollama: { enabled: false } }`
- 自定义地址：`{ ollama: { host: 'http://192.168.1.5:11434' } }`

```js
const tarogo = new TarogoAI({ apiKey: '你的APIKey' }); // baseURL 不用填

// 本地 Ollama 已加载 qwen3.5:2b 时 → 自动走本地；否则 → 走 https://api.tarogo.com
const res = await tarogo.chat.completions.create({
  model: 'qwen3.5:2b',
  messages: [{ role: 'user', content: '你好' }],
});
```

> 说明：`base_url` / `baseUrl` / `api_key` 字段会被 SDK 自动剥离，不会透传给上游。

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
   （npm 网页生成：Access Tokens → Generate New Token → 类型选 Granular Access Token，
   Permissions 选 **Read and write**、勾选 **Bypass two-factor authentication**、选择 All Packages）
3. 确认 `package.json` 中 `repository` / `bugs` 字段为真实仓库地址

### 发布内容

发布内容由 `package.json` 的 `files` 白名单控制（`src/`、`types/`、`README.md`、`LICENSE`），不含测试代码。

## 目录结构

```
.
├── src/                 # SDK 源码（发布）
│   ├── index.js         # CommonJS 入口
│   ├── index.mjs        # ESM 入口
│   ├── client.js        # TarogoAI 客户端核心
│   ├── errors.js        # 错误类型
│   ├── stream.js        # SSE 流式解析
│   └── ollama.js        # 本地 Ollama 检测（/api/tags）
├── types/index.d.ts     # TypeScript 类型声明（发布）
├── test/sdk.test.js     # SDK 测试
├── LICENSE
└── package.json
```

## License

MIT