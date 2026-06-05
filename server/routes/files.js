import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import mime from 'mime-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = Router();

const uploadsDir = path.join(__dirname, '..', 'uploads');

// Allowed file types
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  'application/json',
  'application/zip', 'application/x-tar', 'application/gzip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dateDir = new Date().toISOString().slice(0, 10);
    const dir = path.join(uploadsDir, dateDir);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = `${uuidv4()}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${file.mimetype}`));
    }
  },
});

// POST /api/files/upload - Upload single file
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未选择文件' });
  }

  const relativePath = path.relative(uploadsDir, req.file.path);
  const fileUrl = `/uploads/${relativePath.replace(/\\/g, '/')}`;

  res.json({
    success: true,
    file: {
      id: path.basename(req.file.filename, path.extname(req.file.filename)),
      name: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size,
      url: fileUrl,
    },
  });
});

// POST /api/files/upload-multiple - Upload multiple files
router.post('/upload-multiple', upload.array('files', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '未选择文件' });
  }

  const files = req.files.map(file => {
    const relativePath = path.relative(uploadsDir, file.path);
    return {
      id: path.basename(file.filename, path.extname(file.filename)),
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
      url: `/uploads/${relativePath.replace(/\\/g, '/')}`,
    };
  });

  res.json({ success: true, files });
});

// GET /api/files/list - List uploaded files
router.get('/list', (req, res) => {
  const files = [];
  function walk(dir, prefix = '') {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, `${prefix}${entry.name}/`);
      } else {
        const stat = fs.statSync(fullPath);
        files.push({
          name: entry.name,
          type: mime.lookup(entry.name) || 'application/octet-stream',
          size: stat.size,
          url: `/uploads/${prefix}${entry.name}`,
          createdAt: stat.birthtime,
        });
      }
    }
  }
  walk(uploadsDir);
  files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(files);
});

// Error handling for multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件过大，最大支持50MB' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

export default router;
