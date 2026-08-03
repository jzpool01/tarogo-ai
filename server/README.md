# TarogoAI 代理服务（内部）

这是部署在 `https://api.tarogo.com` 的 OpenAI 兼容代理服务源码，**不随 npm 包发布**，供服务端部署使用。

## 启动

```bash
cd ..   # 仓库根目录
npm install          # 安装依赖（express / cors / dotenv 为 devDependencies）
npm run serve        # 或 node server/server.js
```

## 配置

见根目录 `.env.example`：`PORT`（默认 3000）、`DEFAULT_BASE_URL`（默认 `https://api.tarogo.com`）。

## 功能

- 透传全部 `/v1/*` OpenAI 兼容接口
- API Key 支持 `Authorization: Bearer` / `X-Api-Key` / body `api_key`
- 请求带 `base_url`（body）或 `X-Base-URL`（请求头）时单次覆盖上游地址
- SSE 流式透传、请求日志、统一错误响应

## 本地 Ollama 模型优先路由

服务会通过 `http://localhost:11434`（可用 `OLLAMA_HOST` 修改）检查本机 Ollama，
并缓存**当前已加载到内存**的模型清单（`GET /api/ps`）。

路由优先级：

1. 请求显式带 `base_url` / `X-Base-URL` → 走用户指定地址（显式意图优先）
- 请求的模型在本地 Ollama **已加载清单**中（支持省略 tag，如请求 `llama3` 命中 `llama3:8b`）
   → 直接转发到 `{OLLAMA_HOST}/v1/*`（Ollama 内置 OpenAI 兼容端点）
3. 否则 → 默认上游 `DEFAULT_BASE_URL`

命中本地模型时：

- 响应头 `X-Tarogo-Ollama: <model>` 标记本地路由
- 日志输出 `[TarogoAI] 命中本地 Ollama 模型 "xxx" → http://localhost:11434/...`
- `GET /health` 返回 `ollama` 字段（`enabled` / `host` / `available` / `models`）

环境变量（见根目录 `.env.example`）：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `OLLAMA_ENABLED` | 是否启用本地路由 | `true` |
| `OLLAMA_HOST` | Ollama 地址 | `http://localhost:11434` |
| `OLLAMA_CACHE_TTL` | 模型清单缓存毫秒 | `10000` |
| `OLLAMA_TIMEOUT` | 探测超时毫秒 | `1500` |

> 说明：本服务只是「API 网关」本身（`tarogo-ai` SDK 的发布内容不包含 server 目录）。
> Ollama 本地路由是网关侧能力，SDK 用户通过 `api.tarogo.com` 访问时即可自动享受。