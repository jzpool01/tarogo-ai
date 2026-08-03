'use strict';

/**
 * TarogoAI Hello World 示例
 *
 * 运行方式（任选其一）:
 *   方式一：直连线上服务（默认 https://api.tarogo.com）
 *     TAROGO_API_KEY=你的APIKey node hello.js
 *
 *   方式二：本地代理 + 本地 Ollama 演示（命中本地模型，零成本）
 *     先启动代理：cd .. && npm run serve
 *     TAROGO_API_KEY=sk-demo TAROGO_PROXY_URL=http://localhost:3000/v1 \
 *     TAROGO_MODEL=qwen3.5:2b node hello.js
 */
const TarogoAI = require('tarogo-ai');

async function main() {
  // 只需一个 API Key；不传 baseURL 时默认连 https://api.tarogo.com
  const tarogo = new TarogoAI({
    apiKey: process.env.TAROGO_API_KEY || 'sk-demo',
    baseURL: process.env.TAROGO_PROXY_URL, // 可选：指向本地代理或其他 OpenAI 兼容地址
  });

  const model = process.env.TAROGO_MODEL || 'gpt-4o';
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