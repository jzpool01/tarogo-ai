'use strict';

/** 从 SSE data 行中提取数据（兼容多行 data: 拼接） */
function extractData(rawEvent) {
  return rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
}

/**
 * 将 fetch Response 的 SSE 流解析为异步迭代器，逐块产出
 * OpenAI 风格的 chunk 对象，遇到 [DONE] 结束。
 *
 * @param {Response} response
 * @returns {AsyncGenerator<object, void, undefined>}
 */
async function* createStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = extractData(rawEvent);
        if (data === '[DONE]') return;
        if (data) yield JSON.parse(data);
      }
    }

    // 处理末尾未以空行结束的残留数据
    const tail = extractData(buffer);
    if (tail && tail !== '[DONE]') yield JSON.parse(tail);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

module.exports = { createStream };