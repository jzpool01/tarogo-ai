'use strict';

/**
 * TarogoAI 流式输出示例
 *
 * 运行方式：
 *   TAROGO_API_KEY=你的APIKey TAROGO_MODEL=qwen3.5:2b node streaming.js
 *   （baseURL 无需填写；本地 Ollama 有该模型时自动走本地）
 */
const TarogoAI = require('tarogo-ai');

async function main() {
  const tarogo = new TarogoAI({
    apiKey: process.env.TAROGO_API_KEY || 'sk-demo',
  });

  const model = process.env.TAROGO_MODEL || 'gpt-4o';
  console.log(`🤖 流式对话 (${tarogo.baseURL}, ${model})\n`);

  const stream = await tarogo.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: '你是一个乐于助人的助手，回答要简洁。' },
      { role: 'user', content: '用一句话介绍你自己。' },
    ],
    stream: true,
  });

  let text = '';
  let thinking = '';
  process.stdout.write('💬 ');
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta || {};
    const reasoning = delta.reasoning || '';
    const content = delta.content || '';
    if (reasoning) {
      thinking += reasoning;
      // 思考过程单独一行显示（思考型模型如 qwen3.5 会用 reasoning 字段）
      process.stdout.write(`\r🤔 ${thinking}`);
    }
    if (content) {
      process.stdout.write(content);
      text += content;
    }
  }
  console.log('\n\n✅ 流式输出完成，共', text.length, '字');
  if (thinking) console.log('（其中思考过程', thinking.length, '字，未计入回复）');
}

main().catch((err) => {
  console.error('❌ 调用失败:', err.message);
  process.exit(1);
});