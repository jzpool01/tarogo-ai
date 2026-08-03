# TarogoAI SDK 使用示例

本目录包含可运行的示例，演示如何使用 `tarogo-ai` SDK。

## 安装

```bash
cd example
npm install
```

## 方式一：直连线上服务（默认 `https://api.tarogo.com`）

只需一个 API Key：

```bash
TAROGO_API_KEY=你的APIKey npm run hello
TAROGO_API_KEY=你的APIKey npm run streaming
```

## 方式二：本地代理 + 本地 Ollama 演示（推荐体验）

仓库自带 OpenAI 兼容代理服务，并内置**本地 Ollama 优先路由**：
只要请求的模型在本地 Ollama 清单中，就直接走本机推理，零 API 费用。

```bash
# 1. 先在仓库根目录启动代理服务
cd ..
npm run serve

# 2. 另开终端，运行示例（TAROGO_MODEL 换成你本地已有的模型名）
cd example
TAROGO_API_KEY=sk-demo TAROGO_PROXY_URL=http://localhost:3000/v1 TAROGO_MODEL=qwen3.5:2b npm run hello
TAROGO_API_KEY=sk-demo TAROGO_PROXY_URL=http://localhost:3000/v1 TAROGO_MODEL=qwen3.5:2b npm run streaming
```

查看本地已有模型：
```bash
curl http://localhost:11434/api/tags
# 或通过代理健康检查
curl http://localhost:3000/health
```

## 环境变量说明

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `TAROGO_API_KEY` | API Key（必填，演示可用任意非空值） | `sk-demo` |
| `TAROGO_PROXY_URL` | 代理/服务地址 | 不设则用 `https://api.tarogo.com` |
| `TAROGO_MODEL` | 使用的模型名 | `gpt-4o` |

## 文件说明

| 文件 | 内容 |
| --- | --- |
| `hello.js` | Hello World：基础对话补全 |
| `streaming.js` | 流式输出：逐块实时接收回复 |

> 💡 提示：如果模型是"思考型"（如 `qwen3.5`），首条回复前会先经过一段思考，
> 非流式（`hello.js`）需要等完整思考+回复结束才会返回，可能要 1-2 分钟；
> 流式（`streaming.js`）会先实时显示 🤔 思考过程，体验更好。
> 追求秒回可用非思考型小模型（如 `qwen2.5:0.5b`）。