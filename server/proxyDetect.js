/**
 * Auto-detect local HTTP proxy for outbound requests blocked by GFW.
 *
 * Priority:
 *  1. Explicit env vars (HTTPS_PROXY / ALL_PROXY / HTTP_PROXY)
 *  2. macOS system proxy settings (scutil --proxy)
 *  3. Well-known local proxy ports probe (Clash / V2Ray / Surge / SS-NG)
 *  4. Empty string → direct connection
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import net from 'net';

const execFileAsync = promisify(execFile);

/** Read proxy URL from environment variables */
function proxyFromEnv() {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.ALL_PROXY   ||
    process.env.all_proxy   ||
    process.env.HTTP_PROXY  ||
    process.env.http_proxy  ||
    ''
  );
}

/** Read macOS system proxy settings via scutil */
async function proxyFromScutil() {
  try {
    const { stdout } = await execFileAsync('scutil', ['--proxy'], { timeout: 3000 });
    // HTTPS proxy takes priority
    const httpsEnabled = /HTTPSEnable\s*:\s*1/.test(stdout);
    const httpsHost    = stdout.match(/HTTPSProxy\s*:\s*([^\s\n]+)/)?.[1];
    const httpsPort    = stdout.match(/HTTPSPort\s*:\s*(\d+)/)?.[1];
    if (httpsEnabled && httpsHost && httpsPort) {
      return `http://${httpsHost}:${httpsPort}`;
    }
    const httpEnabled = /HTTPEnable\s*:\s*1/.test(stdout);
    const httpHost    = stdout.match(/HTTPProxy\s*:\s*([^\s\n]+)/)?.[1];
    const httpPort    = stdout.match(/HTTPPort\s*:\s*(\d+)/)?.[1];
    if (httpEnabled && httpHost && httpPort) {
      return `http://${httpHost}:${httpPort}`;
    }
  } catch {
    // scutil not available (non-macOS) or failed
  }
  return '';
}

/** Quick TCP port probe: resolves true if port is open, false otherwise */
function isPortOpen(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => done(true));
    sock.on('error',   () => done(false));
    sock.on('timeout', () => done(false));
    sock.connect(port, host);
  });
}

/** Probe common local proxy ports */
const PROBE_PORTS = [
  { port: 7890,  label: 'Clash HTTP'       },
  { port: 7897,  label: 'Clash HTTP alt'   },
  { port: 10809, label: 'V2RayN HTTP'      },
  { port: 1087,  label: 'ShadowsocksX-NG' },
  { port: 6152,  label: 'Surge HTTP'       },
  { port: 8080,  label: 'Generic HTTP'     },
  { port: 1080,  label: 'SOCKS (fallback)' },
];

async function proxyFromProbe() {
  for (const { port } of PROBE_PORTS) {
    if (await isPortOpen('127.0.0.1', port)) {
      return `http://127.0.0.1:${port}`;
    }
  }
  return '';
}

/** Cached result so we only detect once per process lifetime */
let _cachedProxy = undefined;

export async function detectProxy() {
  if (_cachedProxy !== undefined) return _cachedProxy;

  // 1. Env vars (explicit, instant)
  const envProxy = proxyFromEnv();
  if (envProxy) {
    _cachedProxy = envProxy;
    return _cachedProxy;
  }

  // 2. macOS system proxy (fast, authoritative)
  const scutilProxy = await proxyFromScutil();
  if (scutilProxy) {
    _cachedProxy = scutilProxy;
    return _cachedProxy;
  }

  // 3. Port probe (covers cases where system proxy isn't registered)
  const probedProxy = await proxyFromProbe();
  _cachedProxy = probedProxy;
  return _cachedProxy;
}

/** Reset cache (useful for testing or hot-reload) */
export function resetProxyCache() {
  _cachedProxy = undefined;
}
