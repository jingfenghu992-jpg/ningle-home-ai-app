export default function handler(req, res) {
  const keys = {
    // 线上只需要这两项（与 Vercel 环境变量页面一致）
    STEPFUN_API_KEY: !!process.env.STEPFUN_API_KEY,
    BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN
  };

  res.status(200).json(keys);
}
