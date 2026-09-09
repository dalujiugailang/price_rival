import fs from 'node:fs';

// Deployment-specific identities stay in the ignored, persistent data directory.
// Display profiles never grant access; migration only imports existing allowlists.
export const loadAccessBootstrap = (filePath = new URL('../data/access-bootstrap.json', import.meta.url)) => {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { admins: [], profiles: {} };
    throw error;
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('权限初始化配置必须是 JSON 对象');
  }
  const admins = config.admins ?? [];
  const profiles = config.profiles ?? {};
  if (!Array.isArray(admins) || admins.some(id => typeof id !== 'string' || !id.trim())
    || typeof profiles !== 'object' || profiles === null || Array.isArray(profiles)) {
    throw new Error('权限初始化配置需要 admins 数组和 profiles 对象');
  }
  return { admins, profiles };
};

const bootstrap = loadAccessBootstrap();
export const DEFAULT_ADMIN_OPEN_IDS = bootstrap.admins;
export const ACCESS_PROFILES = bootstrap.profiles;
