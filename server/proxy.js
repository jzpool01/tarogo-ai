'use strict';

const { Readable } = require('node:stream');

const STREAMING_CT = /^text\/event-stream/i;
const JSON_CT = /^application\/json/i;

/**
 * 去掉 TarogoAI 自定义字段，避免透传给上游：
 * - base_url / baseUrl：单次请求的上游地址覆盖
 * - api_key：API Key（已通过 Authorization 头透传）
 */
function cleanBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const cleaned = { ...body };
  delete cleaned.base_url;
  delete cleaned.baseUrl;
  delete cleaned.api_key;
  return cleaned;
}

/**
 * 从请求中提取 API Key，优先级：
 * 1. Authorization: Bearer <key>
 * 2. X-Api-Key 请求头
 * 3. body.api_key
 */
function extractApiKey(req) {
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  if (req.headers['x-api-key']) {
    return String(req.headers['x-api-key']).trim();
  }
  const body = req.body || {};
  if (typeof body.api_key === 'string' && body.api_key.trim()) {
    return body.api_key.trim();
  }
  return null;
}

/**
 * 提取用户显式指定的上游地址（未指定时返回空字符串）：
 * 1. body.base_url / body.baseUrl（单次请求覆盖）
 * 2. X-Base-URL 请求头
 */
function extractExplicitBaseUrl(req) {
  const body = req.body || {};
  const fromBody =
    (typeof body.base_url === 'string' && body.base_url.trim()) ||
    (typeof body.baseUrl === 'string' && body.baseUrl.trim()) ||
    '';
  const fromHeader =
    typeof req.headers['x-base-url'] === 'string' ? req.headers['x-base-url'].trim() : '';
  return fromBody || fromHeader || '';
}

/** 提取上游地址：显式指定优先，否则用默认地址 */
function extractBaseUrl(req, defaultBaseUrl) {
  return extractExplicitBaseUrl(req) || defaultBaseUrl;
}

/** 拼接上游完整 URL（保留原始路径与查询参数） */
function buildTargetUrl(req, baseUrl) {
  const clean = String(baseUrl).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(clean)) {
    throw new Error(`base URL 必须以 http(s):// 开头，实际为: ${baseUrl}`);
  }
  return new URL(clean + req.url);
}

/** 构建转发给上游的请求头 */
function buildUpstreamHeaders(req, apiKey, contentType) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: req.headers.accept || 'application/json',
  };
  if (contentType) headers['Content-Type'] = contentType;
  if (req.headers['user-agent']) headers['User-Agent'] = req.headers['user-agent'];
  if (req.headers['x-request-id']) headers['X-Request-Id'] = req.headers['x-request-id'];
  return headers;
}

/** 统一的 OpenAI 风格错误响应 */
function sendJsonError(res, status, message) {
  return res.status(status).json({
    error: {
      message,
      type: 'invalid_request_error',
      param: null,
      code: null,
    },
  });
}

/**
 * 创建代理处理器。
 * @param {{ defaultBaseUrl: string, ollama?: import('./ollama').OllamaClient }} options
 */
function createProxy({ defaultBaseUrl, ollama = null } = {}) {
  return async function proxyRequest(req, res, next) {
    try {
      // 1. 校验 API Key
      const apiKey = extractApiKey(req);
      if (!apiKey) {
        return sendJsonError(
          res,
          401,
          '缺少 API Key。请通过 "Authorization: Bearer <key>"、"X-Api-Key" 请求头或 "api_key" body 字段提供。'
        );
      }

      // 2. 计算目标地址（本地优先路由）
      //    优先级：显式 base_url/X-Base-URL > 本地 Ollama 命中 > 默认上游
      const explicitBaseUrl = extractExplicitBaseUrl(req);
      let baseUrl;
      let localModel = null;

      if (explicitBaseUrl) {
        baseUrl = explicitBaseUrl;
      } else if (ollama) {
        const model = (req.body || {}).model;
        if (typeof model === 'string' && (await ollama.hasModel(model))) {
          baseUrl = ollama.host;
          localModel = model;
          console.log(
            `[TarogoAI] 命中本地 Ollama 模型 "${model}" → ${ollama.host}${req.url}`
          );
        } else {
          baseUrl = defaultBaseUrl;
        }
      } else {
        baseUrl = defaultBaseUrl;
      }

      let targetUrl;
      try {
        targetUrl = buildTargetUrl(req, baseUrl);
      } catch (err) {
        return sendJsonError(res, 400, `无效的上游地址: ${err.message}`);
      }

      // 3. 组装转发请求
      const isJson = JSON_CT.test(req.headers['content-type'] || '');
      const isStreaming = Boolean((req.body || {}).stream);

      let bodyToSend;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (isJson) {
          bodyToSend = JSON.stringify(cleanBody(req.body));
        } else if (req.rawBody && req.rawBody.length > 0) {
          // 非 JSON（如 multipart 文件上传）直接透传原始 body
          bodyToSend = req.rawBody;
        }
      }

      // 4. 请求上游
      let upstreamRes;
      try {
        upstreamRes = await fetch(targetUrl, {
          method: req.method,
          headers: buildUpstreamHeaders(
            req,
            apiKey,
            isJson ? 'application/json' : req.headers['content-type'] || ''
          ),
          body: bodyToSend,
          redirect: 'follow',
        });
      } catch (err) {
        console.error(`[TarogoAI] 上游请求失败 (${targetUrl.href}): ${err.message}`);
        return sendJsonError(res, 502, `无法连接上游 ${targetUrl.origin}: ${err.message}`);
      }

      // 5. 回传响应（支持 SSE 流式透传）
      res.status(upstreamRes.status);
      res.setHeader('X-Tarogo-AI', 'TarogoAI proxy');
      if (localModel) {
        res.setHeader('X-Tarogo-Ollama', localModel);
      }
      const contentType = upstreamRes.headers.get('content-type') || '';
      if (contentType) res.setHeader('Content-Type', contentType);

      if (upstreamRes.body) {
        if (isStreaming || STREAMING_CT.test(contentType)) {
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          Readable.fromWeb(upstreamRes.body).pipe(res);
        } else {
          const text = await upstreamRes.text();
          res.send(text);
        }
      } else {
        res.end();
      }
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  createProxy,
  cleanBody,
  extractApiKey,
  extractExplicitBaseUrl,
  extractBaseUrl,
  buildTargetUrl,
};