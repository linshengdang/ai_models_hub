import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import providerRoutes from './routes/providers.js';
import chatRoutes from './routes/chat.js';
import fileRoutes from './routes/files.js';
import authRoutes from './routes/auth.js';
import statsRoutes from './routes/stats.js';
import { loadLocalEnv } from './env.js';

import { userStorage } from './context.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadLocalEnv(path.join(__dirname, '..'));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use((req, res, next) => {
  const userId = req.headers['x-user-id'] || 'guest';
  userStorage.run({ userId }, () => {
    next();
  });
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const configPath = path.join(dataDir, 'config.json');
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({ providers: {} }, null, 2));
}

// Static files for uploads
app.use('/uploads', express.static(uploadsDir));

// API routes
app.use('/api/providers', providerRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/stats', statsRoutes);

// Serve standalone verification pages from client/public
const clientPublicDir = path.join(__dirname, '..', 'client', 'public');
if (fs.existsSync(clientPublicDir)) {
  const verifyPages = [
    'copilot-verify.html',
    'codex-verify.html',
    'claude-code-verify.html',
    'cursor-verify.html',
    'kimi-verify.html',
    'antigravity-verify.html',
  ];
  for (const page of verifyPages) {
    const pagePath = path.join(clientPublicDir, page);
    if (fs.existsSync(pagePath)) {
      app.get(`/${page}`, (req, res) => res.sendFile(pagePath));
    }
  }
}

// Serve built client
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
