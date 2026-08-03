'use strict';

const express = require('express');
const cors = require('cors');

const config = require('./config');
const { createProxy } = require('./proxy');
const { OllamaClient } = require('./ollama');

/**
 * 创建 TarogoAI 应用。
 * @param {{
 *   defaultBaseUrl?: string,
 *   ollamaEnabled?: boolean,
 *   ollamaHost?: string,
 *   ollamaCacheTTL?: number,
 *   ollamaTimeout?: number,
 *   fetch?: typeof fetch,
 * }} [options] 测试或嵌入式使用时可通过该参数覆盖
 */
function createApp(options = {}) {
  const defaultBaseUrl = config.normalizeBaseUrl(
    options.defaultBaseUrl || config.defaultBaseUrl
  );
  const ollama = new OllamaClient({
    host: options.ollamaHost || config.ollama.host,
    enabled: options.ollamaEnabled !== undefined ? options.ollamaEnabled : config.ollama.enabled,
    cacheTTL: options.ollamaCacheTTL || config.ollama.cacheTTL,
    timeout: options.ollamaTimeout || config.ollama.timeout,
    fetchFn: options.fetch,
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(cors());

  // 捕获原始 body：JSON 由 express.json 解析并存入 req.rawBody；
  // 非 JSON（multipart 等）保留原始 Buffer 用于透传。
  app.use((req, res, next) => {
    req.rawBody = Buffer.alloc(0);
    next();
  });
  app.use(
    express.json({
      limit: '20mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // 请求日志
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(
        `[TarogoAI] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`
      );
    });
    next();
  });

  const proxyRequest = createProxy({ defaultBaseUrl, ollama });

  // 健康检查
  app.get('/health', async (req, res) => {
    const [ollamaAvailable, ollamaModels] = await Promise.all([
      ollama.isAvailable(),
      ollama.listModels(),
    ]);
    res.json({
      status: 'ok',
      name: 'TarogoAI',
      defaultBaseUrl,
      ollama: {
        enabled: ollama.enabled,
        host: ollama.host,
        available: ollamaAvailable,
        models: ollamaModels,
      },
    });
  });

  // OpenAI 兼容接口：/v1/* 全部透传代理
  app.all('/v1/*', proxyRequest);
  app.all('/v1', proxyRequest);

  // 其他路径 404
  app.use((req, res) => {
    res.status(404).json({
      error: {
        message: `Not found: ${req.method} ${req.originalUrl}`,
        type: 'invalid_request_error',
      },
    });
  });

  // 统一错误处理
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
      return res
        .status(413)
        .json({ error: { message: '请求体过大', type: 'invalid_request_error' } });
    }
    if (err instanceof SyntaxError) {
      return res
        .status(400)
        .json({ error: { message: '请求体不是合法 JSON', type: 'invalid_request_error' } });
    }
    console.error('[TarogoAI] 内部错误:', err);
    return res.status(500).json({ error: { message: 'Internal server error', type: 'server_error' } });
  });

  return app;
}

module.exports = { createApp };