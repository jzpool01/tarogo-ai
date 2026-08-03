'use strict';

/**
 * Ollama 本地模型客户端：
 * - 通过 {host}/api/ps 检测 Ollama 服务是否存在并获取**当前已加载**的模型清单
 * - 模型清单带 TTL 缓存，避免每个请求都探测 Ollama
 *
 * 路由语义：只要请求的模型在本地清单中，就直接转发到
 * {host}/v1/*（Ollama 内置 OpenAI 兼容端点），无需额外转换。
 */
class OllamaClient {
  /**
   * @param {object} [options]
   * @param {string} [options.host] Ollama 地址，默认 http://localhost:11434
   * @param {boolean} [options.enabled] 是否启用本地路由
   * @param {number} [options.cacheTTL] 模型清单缓存毫秒数
   * @param {number} [options.timeout] 探测超时毫秒数
   * @param {typeof fetch} [options.fetchFn] 自定义 fetch（测试注入用）
   */
  constructor({
    host,
    enabled = true,
    cacheTTL = 10000,
    timeout = 1500,
    fetchFn,
  } = {}) {
    this.host = String(
      host || process.env.OLLAMA_HOST || 'http://localhost:11434'
    ).replace(/\/+$/, '');
    this.enabled = Boolean(enabled);
    this.cacheTTL = cacheTTL;
    this.timeout = timeout;
    this.fetchFn = fetchFn || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  }

  _fetchPs() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    return this.fetchFn(`${this.host}/api/ps`, { signal: controller.signal }).finally(() =>
      clearTimeout(timer)
    );
  }

  /**
   * 获取当前已加载到内存的本地模型清单（带 TTL 缓存）。
   */
  /** 带 TTL 缓存的 /api/ps 加载（成功/失败均缓存，避免频繁探测） */
  async _loadModels() {
    if (!this.enabled || !this.fetchFn) return [];

    const now = Date.now();
    if (this._models && now - this._models.fetchedAt < this.cacheTTL) {
      return this._models;
    }

    let ok = false;
    let names = [];
    try {
      const res = await this._fetchPs();
      ok = res.ok;
      if (ok) {
        const data = await res.json();
        names = Array.isArray(data.models)
          ? data.models.map((m) => m && m.name).filter(Boolean)
          : [];
      }
    } catch {
      // 连接失败视为无本地模型，静默降级，不阻断转发
      ok = false;
    }
    this._models = { names, fetchedAt: now, ok };
    return this._models;
  }

  /**
   * 获取本地模型清单（带 TTL 缓存）。
   * Ollama 不可用时返回 []，不抛错。
   * @returns {Promise<string[]>}
   */
  async listModels() {
    if (!this.enabled || !this.fetchFn) return [];
    return [...(await this._loadModels()).names];
  }

  /** Ollama 服务是否可用 */
  async isAvailable() {
    if (!this.enabled || !this.fetchFn) return false;
    return (await this._loadModels()).ok;
  }

  /**
   * 判断模型是否在本地清单中。
   * - 精确匹配：请求 "llama3:8b" 命中本地 "llama3:8b"
   * - 省略 tag 匹配：请求 "llama3" 命中本地 "llama3:8b"
   * @param {string} model
   * @returns {Promise<boolean>}
   */
  async hasModel(model) {
    if (!model || typeof model !== 'string') return false;
    const names = await this.listModels();
    const target = model.trim();
    if (!target) return false;
    if (names.includes(target)) return true;
    return names.some((name) => name.split(':')[0] === target);
  }
}

module.exports = { OllamaClient };