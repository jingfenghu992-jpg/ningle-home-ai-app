/// <reference types="vite/client" />

// 说明：
// - 前端代码不应直接读取 server-only 的密钥；这里仅保留最小化的 process.env 类型，
//   以避免少量历史代码/依赖在类型检查时报错。
declare const process: {
  env: Record<string, string | undefined>;
};
