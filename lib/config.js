// Token 与项目配置存取。
// Token 只存在两个地方：环境变量 CNB_TOKEN（优先）或 ~/.cnb-npc/config.json。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR = path.join(os.homedir(), '.cnb-npc');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

/** 取 Token：环境变量优先，其次本地配置文件。 */
export function getToken() {
  if (process.env.CNB_TOKEN) return process.env.CNB_TOKEN.trim();
  const cfg = loadConfig();
  return cfg && cfg.token ? cfg.token : null;
}

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  try {
    // 令牌文件仅本人可读写（Unix）；Windows 上 chmod 近乎无效，忽略即可
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* 平台不支持时忽略 */
  }
  return CONFIG_PATH;
}

export function configPath() {
  return CONFIG_PATH;
}
