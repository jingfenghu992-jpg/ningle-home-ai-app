export default function handler(req, res) {
  const deepseek = !!process.env.DEEPSEEK_API_KEY;
  const image = !!process.env.STEPFUN_IMAGE_API_KEY;
  const vision = !!process.env.STEPFUN_VISION_API_KEY;
  
  res.status(200).json({
    ok: true,
    env: {
      DEEPSEEK_API_KEY: deepseek,
      STEPFUN_IMAGE_API_KEY: image,
      STEPFUN_VISION_API_KEY: vision
    }
  });
}
