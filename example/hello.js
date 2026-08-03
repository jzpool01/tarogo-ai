'use strict';

/**
 * TarogoAI Hello World 示例
 *
 * 运行方式:
 *   只需一个 API Key，baseURL 无需填写（默认 https://api.tarogo.com）：
 *     node hello.js
 *
 *   SDK 会自动根据模型名路由：
 *   - 本地 Ollama 已加载该模型（默认 qwen3.5:2b）→ 自动走本地（零成本）
 *   - 本地没有 → 自动走默认上游 https://api.tarogo.com
 */
const TarogoAI = require('tarogo-ai');

async function main() {
  // 只需一个 API Key；baseURL 不填，默认 https://api.tarogo.com
  const tarogo = new TarogoAI({
    apiKey: process.env.TAROGO_API_KEY || 'sk-demo',
  });

  const model = process.env.TAROGO_MODEL || 'qwen3.5:2b';
  console.log(`🤖 连接 TarogoAI: ${tarogo.baseURL}`);
  console.log(`📦 使用模型: ${model}\n`);

  const completion = await tarogo.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: '你是一个乐于助人的助手，回答要简洁。' },
      { role: 'user', content: 'Hello World! 请用一句中文介绍你自己。' },
    ],
  });

  console.log('💬 回复：');
  console.log(completion.choices[0].message.content);
  console.log('\n✅ Hello World 示例运行完成！');
}

main().catch((err) => {
  console.error('❌ 调用失败:', err.message);
  process.exit(1);
});