export default function handler(req, res) {
  res.status(200).json({ status: 'ready', docs_count: 0 });
}
