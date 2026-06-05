import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { detectProxy } from './proxyDetect.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function proxyFetch(url, { method = 'GET', headers = {}, body = undefined, timeoutMs = 15000 } = {}) {
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response;
  } catch (err) {
    // fallback to curl
  }

  const proxyUrl = await detectProxy();
  const timeoutSeconds = Math.ceil(timeoutMs / 1000);
  const attempts = proxyUrl
    ? [{ proxyArg: proxyUrl }, { noProxy: true }]
    : [{ noProxy: true }, {}];

  for (const attempt of attempts) {
    const args = ['-sS', '-i', '--max-time', String(timeoutSeconds), '-X', method, url];
    if (attempt.noProxy) {
      args.push('--noproxy', '*');
    } else if (attempt.proxyArg) {
      args.push('--proxy', attempt.proxyArg);
    }
    for (const [k, v] of Object.entries(headers)) {
      args.push('-H', `${k}: ${v}`);
    }
    if (body) {
      args.push('-d', body);
    }
    try {
      const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
      return parseCurlResponse(stdout);
    } catch (e) {
      // try next
    }
  }
  throw new Error('All connection attempts failed');
}

function parseCurlResponse(raw) {
  const parts = raw.split('\r\n\r\n');
  let headerPart = parts[0];
  let bodyPart = parts.slice(1).join('\r\n\r\n');
  
  if (headerPart.includes('HTTP/1.1 100 Continue') || headerPart.includes('HTTP/2 100 Continue')) {
    headerPart = parts[1];
    bodyPart = parts.slice(2).join('\r\n\r\n');
  }

  const lines = headerPart.split('\r\n');
  const statusLine = lines[0];
  const statusCode = parseInt(statusLine.split(' ')[1], 10);
  const ok = statusCode >= 200 && statusCode < 300;

  return {
    ok,
    status: statusCode,
    text: async () => bodyPart,
  };
}

async function main() {
  const configPath = path.join(__dirname, 'data', 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error('config.json not found');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const providers = config.providers || {};

  const modelsByProvider = {};

  for (const [providerId, provider] of Object.entries(providers)) {
    const key = provider.apiKey || (provider.oauthTokens?.accessToken || '');
    if (!key) {
      continue;
    }

    if (provider.apiFormat === 'openai' && providerId !== 'doubao' && providerId !== 'minimax') {
      const modelsUrl = `${provider.baseUrl}/models`;
      try {
        console.log(`Fetching models for ${providerId} from ${modelsUrl}...`);
        const headers = { 'Content-Type': 'application/json' };
        if (provider.authType === 'custom-header') {
          headers[provider.authHeader || 'Authorization'] = key;
        } else {
          headers.Authorization = `Bearer ${key}`;
        }
        const res = await proxyFetch(modelsUrl, { method: 'GET', headers, timeoutMs: 8000 });
        if (res.ok) {
          const raw = await res.text();
          const data = JSON.parse(raw);
          if (data.data && Array.isArray(data.data)) {
            modelsByProvider[providerId] = data.data.map(m => m.id);
            console.log(`  -> Found ${data.data.length} models.`);
          }
        } else {
          console.log(`  -> Failed with status ${res.status}`);
        }
      } catch (err) {
        console.log(`  -> Error: ${err.message}`);
      }
    }
  }

  console.log('\n=== FETCHED MODEL IDS ===');
  console.log(JSON.stringify(modelsByProvider, null, 2));
  fs.writeFileSync(path.join(__dirname, 'data', 'fetched_models.json'), JSON.stringify(modelsByProvider, null, 2), 'utf-8');
}

main().catch(console.error);
