import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = Router();

function getConfigPath(userId = 'guest') {
  if (userId === 'guest') {
    return path.join(__dirname, '..', 'data', 'config.json');
  }
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(__dirname, '..', 'data', `config_${safeUserId}.json`);
}

function readUserConfig(userId = 'guest') {
  const p = getConfigPath(userId);
  if (!fs.existsSync(p)) return { providers: {} };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return { providers: {} };
  }
}

function getUserIdFromRequest(req) {
  const authHeader = req.headers.authorization;
  const apiKey = authHeader ? authHeader.replace(/^Bearer\s+/, '') : '';
  if (!apiKey || apiKey === 'sk-spacedream-local-dev-key' || apiKey === 'sk-spacedream-guest') {
    return 'guest';
  }
  if (apiKey.startsWith('sk-spacedream-')) {
    const userPart = apiKey.substring('sk-spacedream-'.length);
    return userPart || 'guest';
  }
  return 'guest';
}

function resolveProxyModel(userId, requestModel) {
  const config = readUserConfig(userId);
  const providers = config.providers || {};
  
  let targetProviderId = null;
  let targetModelId = null;
  
  // 1. Check if model ID starts with provider prefix (e.g. "openai-gpt-4o" or "openai:gpt-4o")
  for (const [pId, provider] of Object.entries(providers)) {
    if (requestModel.startsWith(`${pId}-`)) {
      targetProviderId = pId;
      targetModelId = requestModel.substring(pId.length + 1);
      break;
    }
    if (requestModel.startsWith(`${pId}:`)) {
      targetProviderId = pId;
      targetModelId = requestModel.substring(pId.length + 1);
      break;
    }
  }
  
  if (targetProviderId && targetModelId) {
    const provider = providers[targetProviderId];
    const hasModel = provider.models?.some(m => m.id === targetModelId);
    if (hasModel) {
      return { providerId: targetProviderId, modelId: targetModelId };
    }
  }
  
  // 2. Search all providers for this model ID (no prefix)
  const matches = [];
  for (const [pId, provider] of Object.entries(providers)) {
    const hasModel = provider.models?.some(m => m.id === requestModel);
    if (hasModel) {
      matches.push({ providerId: pId, modelId: requestModel });
    }
  }
  
  if (matches.length > 0) {
    return matches[0];
  }
  
  return null;
}

// GET /v1/models - Returns standard OpenAI model list
router.get('/models', (req, res) => {
  const userId = getUserIdFromRequest(req);
  const config = readUserConfig(userId);
  const providers = config.providers || {};
  
  // Count frequency of each model ID to identify duplicates
  const modelCount = {};
  for (const [pId, provider] of Object.entries(providers)) {
    for (const model of provider.models || []) {
      modelCount[model.id] = (modelCount[model.id] || 0) + 1;
    }
  }
  
  const models = [];
  for (const [pId, provider] of Object.entries(providers)) {
    for (const model of provider.models || []) {
      if (modelCount[model.id] > 1) {
        models.push({
          id: `${pId}-${model.id}`,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: pId
        });
      } else {
        models.push({
          id: model.id,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: pId
        });
      }
    }
  }
  
  res.json({
    object: 'list',
    data: models
  });
});

// POST /v1/chat/completions - OpenAI-compatible completion
router.post('/chat/completions', async (req, res) => {
  const userId = getUserIdFromRequest(req);
  const { model, messages, stream } = req.body;
  
  if (!model || !messages) {
    return res.status(400).json({ error: 'model and messages are required' });
  }
  
  const resolved = resolveProxyModel(userId, model);
  if (!resolved) {
    return res.status(404).json({ error: `Model '${model}' not found in configured providers.` });
  }
  
  const { providerId, modelId } = resolved;
  const targetPort = req.socket.localPort || process.env.PORT || 5173;
  const targetUrl = `http://localhost:${targetPort}/api/chat/completions`;
  
  try {
    const localRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId
      },
      body: JSON.stringify({ providerId, modelId, messages })
    });
    
    if (!localRes.ok) {
      const errText = await localRes.text();
      return res.status(localRes.status).send(errText);
    }
    
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const reader = localRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === 'data: [DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.substring(6));
              if (data.text) {
                const chunk = {
                  id: 'chatcmpl-' + Date.now(),
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: model,
                  choices: [
                    {
                      index: 0,
                      delta: { content: data.text },
                      finish_reason: null
                    }
                  ]
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            } catch (err) {
              // skip
            }
          }
        }
      }
      
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const reader = localRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.substring(6));
              if (data.text) {
                fullText += data.text;
              }
            } catch (e) {}
          }
        }
      }
      
      const responseBody = {
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: fullText },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30
        }
      };
      res.json(responseBody);
    }
  } catch (err) {
    console.error('Proxy completions request error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

export default router;
