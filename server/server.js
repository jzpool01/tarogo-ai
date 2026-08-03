'use strict';

const config = require('./config');
const { createApp } = require('./app');

const app = createApp();

app.listen(config.port, () => {
  console.log(`[TarogoAI] 服务已启动: http://localhost:${config.port}`);
  console.log(`[TarogoAI] 默认上游地址: ${config.defaultBaseUrl}`);
  console.log(
    '[TarogoAI] OpenAI 兼容接口: /v1/chat/completions, /v1/completions, /v1/embeddings, /v1/models, ...'
  );
});