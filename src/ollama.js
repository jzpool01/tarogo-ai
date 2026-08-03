'use strict';

/**
 * SDK 内置的本地 Ollama 检测器：
 * - 请求前通过 {host}/api/tags 探测本地 Ollama 是否运行，并获取模型清单（带缓存）
 * - 请求的模型命中本地清单时，SDK 自动改走本地，否则回落到默认上游
 */
class OllamaClient {
  /**
   * @param {object} [options]
   * @param {string} [options.host] 本地 Ollama 地址，默认 http://localhost:11434
   * @param {boolean} [options.enabled] 是否启用本地路由，默认 true
   * @param {number} [options.cacheTTL] 模型清单缓存毫秒，默认 10000
   * @param {number} [options.timeout] 探测超时毫秒，默认 800（快速回落）
   * @param {typeof fetch} [options.fetchFn] 测试注入用
   */
  constructor({
    host = 'http://localhost:11434',
    enabled = true,
    cacheTTL = 10000,
    timeout = 800,
    fetchFn,
  } = {}) {
    this.host = String(host).replace(/\/+$/, '');
    this.enabled = Boolean(enabled);
    this.cacheTTL = cacheTTL;
    this.timeout = timeout;
    this.fetchFn = fetchFn || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
    this._models = null; // { names: string[], fetchedAt: number, ok: boolean }
  }

  _fetchTags() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    return this.fetchFn(`${this.host}/api/tags`, { signal: controller.signal }).finally(() =>
      clearTimeout(timer)
    );
  }

  /** 带缓存的 /api/tags 加载；失败也缓存，避免每次请求都探测 */
  async _loadModels() {
    if (!this.enabled || !this.fetchFn) {
      return { names: [], fetchedAt: Date.now(), ok: false };
    }
    const now = Date.now();
    if (this._models && now - this._models.fetchedAt < this.cacheTTL) {
      return this._models;
    }

    let ok = false;
    let names = [];
    try {
      const res = await this._fetchTags();
      ok = res.ok;
      if (ok) {
        const data = await res.json();
        names = Array.isArray(data.models)
          ? data.models.map((m) => m && m.name).filter(Boolean)
          : [];
      }
    } catch {
      ok = false; // 本地服务未启动，静默回落
    }
    this._models = { names, fetchedAt: now, ok };
    return this._models;
  }

  /** 本地模型清单 */
  async listModels() {
    return [...(await this._loadModels()).names];
  }

  /**
   * 判断模型是否在本地清单中（支持省略 tag：请求 llama3 命中 llama3:8b）
   * @param {string} model
   * @returns {Promise<boolean>}
   */
  async hasModel(model) {
    if (!model || typeof model !== 'string') return false;
    const { names } = await this._loadModels();
    const target = model.trim();
    if (!target) return false;
    if (names.includes(target)) return true;
    return names.some((name) => name.split(':')[0] === target);
  }
}

module.exports = { OllamaClient };