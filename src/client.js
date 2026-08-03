'use strict';

const {
  TarogoAIError,
  APIConnectionError,
  AuthenticationError,
  createError,
} = require('./errors');
const { createStream } = require('./stream');
const { OllamaClient } = require('./ollama');

const DEFAULT_BASE_URL = 'https://api.tarogo.com';
const DEFAULT_TIMEOUT = 10 * 60 * 1000; // 10 分钟

/**
 * 归一化基础地址：
 * - 去掉末尾斜杠
 * - 兼容 "https://api.tarogo.com/v1" 写法（内部路径自带 /v1）
 */
function normalizeBaseURL(input) {
  let clean = String(input).trim().replace(/\/+$/, '');
  if (/\/v1$/i.test(clean)) {
    clean = clean.replace(/\/v1$/i, '');
  }
  return clean;
}

/**
 * TarogoAI 客户端 —— OpenAI 兼容的 LLM SDK。
 *
 * 只需传入 API Key，默认请求 https://api.tarogo.com；
 * 请求时会根据模型名自动检测本地 Ollama：本地服务已启动且包含该模型时，
 * 自动改走本地（零成本、低延迟）；否则回落默认上游。
 * 也支持通过 baseURL（构造/请求级）或请求 body 中的 base_url 参数覆盖上游地址。
 */
class TarogoAI {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] API Key（也可通过环境变量 TAROGO_API_KEY 提供）
   * @param {string} [options.baseURL] 上游基础地址，默认 https://api.tarogo.com
   * @param {number} [options.timeout] 请求超时（毫秒），默认 10 分钟
   * @param {HeadersInit} [options.defaultHeaders] 附加到每个请求的默认请求头
   * @param {typeof fetch} [options.fetch] 自定义 fetch 实现
   * @param {{enabled?: boolean, host?: string, cacheTTL?: number, timeout?: number}|false} [options.ollama]
   *   本地 Ollama 自动路由配置，默认开启；传 false 可关闭
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.TAROGO_API_KEY || '';
    this.baseURL = normalizeBaseURL(options.baseURL || options.baseUrl || DEFAULT_BASE_URL);
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.fetchFn =
      options.fetch ||
      (typeof globalThis !== 'undefined' && globalThis.fetch
        ? globalThis.fetch.bind(globalThis)
        : null);
    this.defaultHeaders = { ...(options.defaultHeaders || {}) };
    this.ollama = new OllamaClient({
      ...(options.ollama && typeof options.ollama === 'object' ? options.ollama : {}),
      enabled: options.ollama === false ? false : true,
      fetchFn: this.fetchFn,
    });

    // OpenAI 风格的命名空间
    this.chat = {
      completions: {
        create: (body, requestOptions) =>
          this._request({
            path: '/v1/chat/completions',
            method: 'POST',
            body,
            requestOptions,
          }),
      },
    };
    this.completions = {
      create: (body, requestOptions) =>
        this._request({
          path: '/v1/completions',
          method: 'POST',
          body,
          requestOptions,
        }),
    };
    this.embeddings = {
      create: (body, requestOptions) =>
        this._request({
          path: '/v1/embeddings',
          method: 'POST',
          body,
          requestOptions,
        }),
    };
    this.models = {
      list: (requestOptions) =>
        this._request({ path: '/v1/models', method: 'GET', body: null, requestOptions }),
      retrieve: (model, requestOptions) =>
        this._request({
          path: `/v1/models/${encodeURIComponent(model)}`,
          method: 'GET',
          body: null,
          requestOptions,
        }),
    };
    // 预留：任意 OpenAI 兼容路径的通用调用
    this.request = (path, body, requestOptions) =>
      this._request({
        path: path.startsWith('/') ? path : `/${path}`,
        method: (requestOptions && requestOptions.method) || 'POST',
        body,
        requestOptions,
      });
  }

  /**
   * 核心请求方法。
   *
   * 上游地址优先级（高 → 低）：
   * 1. body.base_url / body.baseUrl（参数覆盖，自动剥离，不透传给上游）
   * 2. requestOptions.baseURL
   * 3. 本地 Ollama 命中（模型在本地清单且服务可用，自动路由）
   * 4. 构造时 baseURL（默认 https://api.tarogo.com）
   *
   * @param {{ path: string, method: string, body: object|null, requestOptions?: object }} params
   * @returns {Promise<object|AsyncGenerator>} stream:true 时返回异步迭代器
   */
  async _request({ path, method, body, requestOptions = {} }) {
    if (!this.apiKey) {
      throw new AuthenticationError(
        '缺少 API Key。请在构造 TarogoAI 时传入 apiKey 参数，或设置环境变量 TAROGO_API_KEY。'
      );
    }
    if (!this.fetchFn) {
      throw new TarogoAIError('当前环境不支持 fetch（需要 Node.js >= 18 或现代浏览器）。');
    }

    // 地址覆盖：body.base_url > requestOptions.baseURL > 本地 Ollama > this.baseURL
    const payload = { ...(body || {}) };
    const bodyBaseUrl =
      (typeof payload.base_url === 'string' && payload.base_url.trim()) ||
      (typeof payload.baseUrl === 'string' && payload.baseUrl.trim()) ||
      '';
    delete payload.base_url;
    delete payload.baseUrl;
    delete payload.api_key;

    let baseURL;
    if (bodyBaseUrl) {
      baseURL = bodyBaseUrl;
    } else if (requestOptions.baseURL) {
      baseURL = requestOptions.baseURL;
    } else {
      const model = payload.model;
      if (
        this.ollama.enabled &&
        typeof model === 'string' &&
        (await this.ollama.hasModel(model))
      ) {
        baseURL = this.ollama.host;
      } else {
        baseURL = this.baseURL;
      }
    }

    const url = `${normalizeBaseURL(baseURL)}${path}`;

    // 超时 + 外部取消信号
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = requestOptions.timeout || this.timeout;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    if (requestOptions.signal) {
      if (requestOptions.signal.aborted) controller.abort();
      else requestOptions.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...this.defaultHeaders,
      ...(requestOptions.headers || {}),
    };

    let response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw timedOut
          ? new TarogoAIError(`请求超时（${timeoutMs}ms）`, 408)
          : new TarogoAIError('请求已取消', 499);
      }
      throw new APIConnectionError(`无法连接 ${url}: ${err.message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    const isStreaming = Boolean((body || {}).stream);

    // 非 2xx：抛出对应的 OpenAI 风格错误
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      let errorBody = null;
      try {
        errorBody = await response.json();
      } catch {
        // ignore
      }
      if (errorBody && errorBody.error && errorBody.error.message) {
        message = errorBody.error.message;
      }
      throw createError(response.status, message, errorBody, response.headers);
    }

    if (isStreaming) {
      return createStream(response);
    }
    return response.json();
  }
}

module.exports = { TarogoAI, normalizeBaseURL };