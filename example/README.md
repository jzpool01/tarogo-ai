# TarogoAI SDK 使用示例

本目录包含可运行的示例，演示如何使用 `tarogo-ai` SDK。

SDK 的 `baseURL` 无需填写（默认 `https://api.tarogo.com`），并且会**自动根据模型名路由到本地 Ollama**：
本地 Ollama 已启动且包含请求的模型 → 直接走本地（零成本、低延迟）；
否则自动回落默认上游。

## 安装

```bash
cd example
npm install
```

## 运行（只需一个 API Key）

```bash
TAROGO_API_KEY=你的APIKey npm run hello
TAROGO_API_KEY=你的APIKey npm run streaming
```

默认模型为 `qwen3.5:2b`（本地 Ollama 已加载时自动走本地），也可以指定其他模型：

```bash
TAROGO_MODEL=其他模型名 npm run hello
TAROGO_MODEL=其他模型名 npm run streaming
```

查看本地已加载模型：
```bash
curl http://localhost:11434/api/ps
```

## 环境变量说明

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `TAROGO_API_KEY` | API Key（必填，演示可用任意非空值） | `sk-demo` |
| `TAROGO_MODEL` | 使用的模型名 | `qwen3.5:2b` |

## 文件说明

| 文件 | 内容 |
| --- | --- |
| `hello.js` | Hello World：基础对话补全 |
| `streaming.js` | 流式输出：逐块实时接收回复 |

> 💡 提示：如果模型是"思考型"（如 `qwen3.5`），首条回复前会先经过一段思考，
> 非流式（`hello.js`）需要等完整思考+回复结束才会返回，可能要 1-2 分钟；
> 流式（`streaming.js`）会先实时显示 🤔 思考过程，体验更好。
> 追求秒回可用非思考型小模型（如 `qwen2.5:0.5b`）。