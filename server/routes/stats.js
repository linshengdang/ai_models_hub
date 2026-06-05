import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { userStorage } from '../context.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = Router();

const statsPath = path.join(__dirname, '..', 'data', 'stats.json');

// Ensure stats.json exists
function initStatsFile() {
  if (!fs.existsSync(statsPath)) {
    try {
      fs.writeFileSync(statsPath, JSON.stringify({ logs: [] }, null, 2));
    } catch (err) {
      console.error('Failed to initialize stats.json:', err);
    }
  }
}

// Log a usage record
export function logUsage({ userId, providerId, modelId, type, tokens = 0, success = true, errorMsg = '' }) {
  try {
    initStatsFile();
    let stats = { logs: [] };
    if (fs.existsSync(statsPath)) {
      try {
        stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
      } catch (e) {
        stats = { logs: [] };
      }
    }

    const newLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      userId: userId || 'guest',
      providerId: providerId || 'unknown',
      modelId: modelId || 'unknown',
      type: type || 'text', // 'text', 'image', 'audio', 'video'
      tokens: tokens || 0,
      success: !!success,
      errorMsg: errorMsg || ''
    };

    stats.logs.push(newLog);
    // Keep last 1000 logs to prevent file growing too large
    if (stats.logs.length > 1000) {
      stats.logs = stats.logs.slice(-1000);
    }

    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  } catch (err) {
    console.error('Failed to log usage stats:', err);
  }
}

// Estimate tokens for text
export function estimateTokens(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherText = text.replace(/[\u4e00-\u9fa5]/g, '');
  const words = otherText.trim().split(/\s+/).filter(Boolean).length;
  return chineseChars + Math.ceil(words * 1.3);
}

// GET /api/stats endpoint
router.get('/', (req, res) => {
  try {
    initStatsFile();
    const userId = userStorage.getStore()?.userId || 'guest';
    
    let stats = { logs: [] };
    if (fs.existsSync(statsPath)) {
      try {
        stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
      } catch (e) {
        stats = { logs: [] };
      }
    }

    // Filter logs for the current user
    const userLogs = stats.logs.filter(log => log.userId === userId);

    // Calculate metrics
    const totalCalls = userLogs.length;
    const successCount = userLogs.filter(log => log.success).length;
    const failCount = totalCalls - successCount;
    const successRate = totalCalls > 0 ? Math.round((successCount / totalCalls) * 100) : 100;
    const totalTokens = userLogs.reduce((sum, log) => sum + (log.tokens || 0), 0);

    // Grouping stats
    const providerUsage = {};
    const modelUsage = {};
    const typeUsage = { text: 0, image: 0, audio: 0, video: 0 };

    userLogs.forEach(log => {
      // Provider
      providerUsage[log.providerId] = (providerUsage[log.providerId] || 0) + 1;
      // Model
      modelUsage[log.modelId] = (modelUsage[log.modelId] || 0) + 1;
      // Type
      if (typeUsage[log.type] !== undefined) {
        typeUsage[log.type]++;
      } else {
        typeUsage[log.type] = (typeUsage[log.type] || 0) + 1;
      }
    });

    // Get recent logs (max 50)
    const recentLogs = [...userLogs].reverse().slice(0, 50);

    res.json({
      success: true,
      data: {
        metrics: {
          totalCalls,
          successCount,
          failCount,
          successRate,
          totalTokens,
        },
        providerUsage,
        modelUsage,
        typeUsage,
        recentLogs
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
