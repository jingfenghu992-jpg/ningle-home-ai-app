export default function handler(req, res) {
  // This project uses a unified Stepfun key for chat/vision/t2i/i2i.
  // Keep the output stable for the UI/ops checks: booleans only, no secrets.
  const hasStepfunApiKey = !!process.env.STEPFUN_API_KEY;
  const hasStepfunImageApiKey = !!process.env.STEPFUN_IMAGE_API_KEY;
  const hasAnyStepfunKey = hasStepfunApiKey || hasStepfunImageApiKey;

  const keys = {
    // Core (required)
    STEPFUN_API_KEY: hasStepfunApiKey,

    // Optional switches
    ENABLE_DESIGN_SPEC_LLM: process.env.ENABLE_DESIGN_SPEC_LLM === '1',

    // Blob / KB (optional; if absent, app still works but URL-first upload & KB will be disabled)
    BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
    KB_BLOB_PREFIX: !!process.env.KB_BLOB_PREFIX,

    // Legacy/compat (kept for backward visibility)
    STEPFUN_IMAGE_API_KEY: hasStepfunImageApiKey,
    STEPFUN_VISION_API_KEY: !!process.env.STEPFUN_VISION_API_KEY,
    STEPFUN_VISION_API_KEY_2: !!process.env.STEPFUN_VISION_API_KEY_2,
    DEEPSEEK_API_KEY: !!process.env.DEEPSEEK_API_KEY,

    // Clear status fields (recommended to consume)
    hasStepfunApiKey,
    hasStepfunImageApiKey,
    hasAnyStepfunKey,
    stepfunKeyOk: hasAnyStepfunKey,
  };

  res.status(200).json(keys);
}
