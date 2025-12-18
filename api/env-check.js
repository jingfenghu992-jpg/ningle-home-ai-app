export default function handler(req, res) {
  const keys = {
    DEEPSEEK_API_KEY: !!process.env.DEEPSEEK_API_KEY,
    STEPFUN_IMAGE_API_KEY: !!process.env.STEPFUN_IMAGE_API_KEY,
    STEPFUN_VISION_API_KEY: !!process.env.STEPFUN_VISION_API_KEY,
    STEPFUN_VISION_API_KEY_2: !!process.env.STEPFUN_VISION_API_KEY_2
  };

  res.status(200).json(keys);
}
