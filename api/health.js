
export default function handler(req, res) {
  res.status(200).json({
    status: 'ok',
    message: 'Backend Vercel berhasil berjalan',
    time: new Date().toISOString()
  });
}

