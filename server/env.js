import fs from 'fs';
import path from 'path';

function parseEnvValue(raw) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath, lockedKeys) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (lockedKeys.has(key)) continue;
    process.env[key] = parseEnvValue(rawValue);
  }
}

export function loadLocalEnv(rootDir) {
  const lockedKeys = new Set(Object.keys(process.env));
  loadEnvFile(path.join(rootDir, '.env'), lockedKeys);
  loadEnvFile(path.join(rootDir, '.env.local'), lockedKeys);
}
