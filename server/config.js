'use strict';

const path = require('node:path');

// 加载 .env（可选依赖 dotenv，安装失败也不影响运行）
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // dotenv 未安装时忽略，直接使用环境变量
}

/**
 * 归一化上游基础地址：
 * - 去掉末尾斜杠
 * - 兼容 "https://api.tarogo.com/v1" 的写法，统一为不带 /v1 的 origin
 */
function normalizeBaseUrl(input) {
  let clean = String(input).trim().replace(/\/+$/, '');
  if (/\/v1$/i.test(clean)) {
    clean = clean.replace(/\/v1$/i, '');
  }
  return clean;
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  defaultBaseUrl: normalizeBaseUrl(process.env.DEFAULT_BASE_URL || 'https://api.tarogo.com'),
  ollama: {
    // 默认启用本地 Ollama 路由；显式设为 "false" 可关闭
    enabled: process.env.OLLAMA_ENABLED !== 'false',
    host: (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, ''),
    // 本地模型清单缓存毫秒数
    cacheTTL: parseInt(process.env.OLLAMA_CACHE_TTL || '10000', 10),
    // 探测 Ollama 的超时毫秒数（连接失败时快速降级到默认上游）
    timeout: parseInt(process.env.OLLAMA_TIMEOUT || '1500', 10),
  },
};

module.exports = config;
module.exports.normalizeBaseUrl = normalizeBaseUrl;