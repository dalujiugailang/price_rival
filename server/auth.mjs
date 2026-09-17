import crypto from 'node:crypto';
import tls from 'node:tls';
import { ALL_ACCESS_SCOPES, DEFAULT_VIEWER_SCOPES, isEditor } from '../shared/accessPolicy.mjs';
import { ACCESS_PROFILES, DEFAULT_ADMIN_OPEN_IDS } from './accessBootstrap.mjs';

if (typeof tls.setDefaultCACertificates === 'function') {
  tls.setDefaultCACertificates(tls.rootCertificates);
}

const SESSION_COOKIE = 'price_rival_session';
const OAUTH_STATE_COOKIE = 'price_rival_oauth_state';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const AUTH_ROLES = Object.freeze({
  ADMIN: 'admin',
  VIEWER: 'viewer',
  EDITOR: 'editor',
  TRADE_IN_VIEWER: 'tradeInViewer'
});

export const resolveAuthRole = (user, {
  allowedDepartments,
  allowedOpenIds,
  readOnlyDepartments,
  readOnlyOpenIds
}) => {
  const openId = String(user?.openId || '');
  const departmentIds = Array.isArray(user?.departmentIds) ? user.departmentIds : [];
  if (allowedOpenIds.has(openId)) {
    return AUTH_ROLES.EDITOR;
  }
  if (readOnlyOpenIds.has(openId)) {
    return AUTH_ROLES.TRADE_IN_VIEWER;
  }
  if (departmentIds.some(id => allowedDepartments.has(id))) return AUTH_ROLES.EDITOR;
  if (departmentIds.some(id => readOnlyDepartments.has(id))) return AUTH_ROLES.TRADE_IN_VIEWER;
  return null;
};

const splitCsv = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

const parseCookies = header => String(header || '').split(';').reduce((cookies, part) => {
  const separator = part.indexOf('=');
  if (separator < 0) return cookies;
  const key = part.slice(0, separator).trim();
  const value = part.slice(separator + 1).trim();
  if (key) cookies[key] = decodeURIComponent(value);
  return cookies;
}, {});

const cookieText = (name, value, { maxAge, secure, httpOnly = true } = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (typeof maxAge === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join('; ');
};

const fetchJson = async (url, options, label) => {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
    const message = payload.error_description || payload.msg || payload.message || `${response.status} ${response.statusText}`;
    throw new Error(`${label}失败: ${message}`);
  }
  return payload;
};

export const createAuth = ({ db, env, appUrl }) => {
  const appId = env.FEISHU_APP_ID || '';
  const appSecret = env.FEISHU_APP_SECRET || '';
  const allowedDepartments = new Set(splitCsv(env.FEISHU_ALLOWED_DEPARTMENT_IDS));
  const allowedOpenIds = new Set(splitCsv(env.FEISHU_ALLOWED_OPEN_IDS));
  const allowedTenantKeys = new Set(splitCsv(env.FEISHU_ALLOWED_TENANT_KEYS));
  const readOnlyDepartments = new Set(splitCsv(env.FEISHU_READ_ONLY_DEPARTMENT_IDS));
  const readOnlyOpenIds = new Set(splitCsv(env.FEISHU_READ_ONLY_OPEN_IDS));
  db.initializeAccess?.({ editors: [...allowedOpenIds], viewers: [...readOnlyOpenIds],
    admins: env.FEISHU_ADMIN_OPEN_IDS ? splitCsv(env.FEISHU_ADMIN_OPEN_IDS) : DEFAULT_ADMIN_OPEN_IDS,
    profiles: ACCESS_PROFILES });
  // Search tokens stay in server memory only, never in cookies, JSON responses or logs.
  const directoryTokens = new Map();
  const developmentAccess = () => {
    const role = env.AUTH_DEV_ROLE === 'admin' ? 'admin' : ['viewer', 'tradeInViewer'].includes(env.AUTH_DEV_ROLE) ? 'viewer' : 'editor';
    const scopes = env.AUTH_DEV_SCOPES ? splitCsv(env.AUTH_DEV_SCOPES).filter(scope => ALL_ACCESS_SCOPES.includes(scope))
      : role === 'viewer' ? [...DEFAULT_VIEWER_SCOPES] : [...ALL_ACCESS_SCOPES];
    return { role, scopes, enabled: true, accessVersion: 0 };
  };
  const devLoginEnabled = env.NODE_ENV !== 'production' && env.AUTH_DEV_BYPASS === 'true';
  const secureCookie = appUrl.startsWith('https://');
  const callbackUrl = env.FEISHU_REDIRECT_URI || `${appUrl}/api/auth/feishu/callback`;
  const authConfigured = Boolean(appId && appSecret && db.hasMembers?.());

  const resolveRole = user => resolveAuthRole(user, {
    allowedDepartments,
    allowedOpenIds,
    readOnlyDepartments,
    readOnlyOpenIds
  });

  const applyCurrentAccess = user => {
    if (!user) return null;
    if (user.loginType === 'development' && devLoginEnabled) {
      return { ...user, ...developmentAccess() };
    }
    const tenantAllowed = allowedTenantKeys.size === 0 || allowedTenantKeys.has(user.tenantKey);
    const member = tenantAllowed ? db.getMember(user.openId) : null;
    return member?.enabled ? { ...user, name: member.name, role: member.role, scopes: member.scopes,
      enabled: true, accessVersion: member.version } : null;
  };

  const createSession = (res, user) => {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    db.createSession(sha256(token), user, expiresAt);
    res.append('Set-Cookie', cookieText(SESSION_COOKIE, token, {
      maxAge: SESSION_TTL_MS / 1000,
      secure: secureCookie
    }));
  };

  const clearSession = res => {
    res.append('Set-Cookie', cookieText(SESSION_COOKIE, '', { maxAge: 0, secure: secureCookie }));
  };

  const getUser = req => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return token ? applyCurrentAccess(db.getSession(sha256(token))) : null;
  };

  const requestContext = req => ({
    actor: req.authUser || null,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') || ''
  });

  const exchangeCode = async code => {
    const tokenPayload = await fetchJson(
      env.FEISHU_OAUTH_TOKEN_URL || 'https://accounts.feishu.cn/oauth/v3/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: appId,
          client_secret: appSecret,
          code,
          redirect_uri: callbackUrl
        })
      },
      '飞书授权码换 token'
    );
    return tokenPayload.data || tokenPayload;
  };

  const getFeishuUser = async accessToken => {
    const userPayload = await fetchJson(
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
      { headers: { authorization: `Bearer ${accessToken}` } },
      '飞书用户信息查询'
    );
    return userPayload.data || userPayload;
  };

  const getTenantToken = async () => {
    const payload = await fetchJson(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret })
      },
      '飞书租户 token 查询'
    );
    return payload.tenant_access_token || payload.data?.tenant_access_token;
  };

  const getDepartmentIds = async openId => {
    const tenantToken = await getTenantToken();
    const url = new URL('https://open.feishu.cn/open-apis/contact/v3/users/batch');
    url.searchParams.append('user_ids', openId);
    url.searchParams.set('user_id_type', 'open_id');
    url.searchParams.set('department_id_type', 'open_department_id');
    const payload = await fetchJson(
      url,
      { headers: { authorization: `Bearer ${tenantToken}` } },
      '飞书部门信息查询'
    );
    return payload.data?.items?.[0]?.department_ids || [];
  };

  const lookupDirectoryUser = async openId => {
    if (!/^ou_[a-zA-Z0-9]+$/.test(openId)) throw new Error('飞书账号 ID 无效');
    const token = await getTenantToken();
    const payload = await fetchJson(`https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }, '飞书成员查询');
    const contact = payload.data?.user;
    if (!contact?.open_id || !contact?.name || contact.open_id !== openId) throw new Error('未找到该飞书成员');
    if (contact.status?.is_resigned) throw new Error('该成员已离职');
    const profile = { openId, name: contact.name, department: contact.department_name || db.getProfile(openId)?.department || '' };
    db.rememberProfile(profile);
    return profile;
  };

  const searchDirectory = async (user, query) => {
    const local = db.searchProfiles(query);
    if (/^ou_[a-zA-Z0-9]+$/.test(query)) return { users: [await lookupDirectoryUser(query)], requiresLogin: false };
    const credential = directoryTokens.get(user.openId);
    if (!credential || credential.expiresAt <= Date.now()) {
      directoryTokens.delete(user.openId);
      return { users: local, requiresLogin: user.loginType !== 'development' };
    }
    const url = new URL('https://open.feishu.cn/open-apis/search/v1/user');
    url.searchParams.set('query', query); url.searchParams.set('page_size', '20');
    try {
      const payload = await fetchJson(url, { headers: { authorization: `Bearer ${credential.token}` }, signal: AbortSignal.timeout(8000) }, '飞书姓名搜索');
      const contacts = payload.data?.users || [];
      const verified = contacts.filter(contact => contact.open_id && contact.name && !contact.is_external).map(contact => ({
        openId: contact.open_id, name: contact.name, department: contact.department_name || db.getProfile(contact.open_id)?.department || ''
      }));
      verified.forEach(profile => db.rememberProfile(profile));
      return { users: [...new Map([...local, ...verified].map(profile => [profile.openId, profile])).values()], requiresLogin: false };
    } catch {
      directoryTokens.delete(user.openId);
      return { users: local, requiresLogin: true, message: '飞书姓名搜索暂不可用，可重新登录后重试，或输入飞书账号 ID 查询。' };
    }
  };

  const registerRoutes = app => {
    app.get('/api/auth/config', (_req, res) => {
      res.json({
        authConfigured,
        devLoginEnabled,
        loginUrl: '/api/auth/login'
      });
    });

    app.get('/api/auth/me', (req, res) => {
      const user = getUser(req);
      if (!user) {
        res.status(401).json({ success: false, error: '未登录' });
        return;
      }
      res.json({ success: true, user });
    });

    app.get('/api/auth/login', (req, res) => {
      // Local previews may be opened via either loopback name. Set OAuth state
      // on the configured host so the callback can read the same cookie.
      const loginOrigin = new URL(appUrl);
      if (['localhost', '127.0.0.1'].includes(loginOrigin.hostname)
        && req.hostname && req.hostname !== loginOrigin.hostname) {
        res.redirect(new URL('/api/auth/login', loginOrigin).toString());
        return;
      }
      if (!authConfigured) {
        res.status(503).json({ success: false, error: '飞书登录尚未完成服务端配置' });
        return;
      }
      const state = randomToken();
      res.append('Set-Cookie', cookieText(OAUTH_STATE_COOKIE, state, { maxAge: 600, secure: secureCookie }));
      const authorizeUrl = new URL(env.FEISHU_AUTHORIZE_URL || 'https://accounts.feishu.cn/open-apis/authen/v1/authorize');
      authorizeUrl.searchParams.set('app_id', appId);
      authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
      authorizeUrl.searchParams.set('state', state);
      res.redirect(authorizeUrl.toString());
    });

    app.get('/api/auth/feishu/callback', async (req, res) => {
      const cookies = parseCookies(req.headers.cookie);
      const code = String(req.query.code || '');
      const state = String(req.query.state || '');
      try {
        if (!code || !state || state !== cookies[OAUTH_STATE_COOKIE]) {
          throw new Error('飞书登录 state 校验失败');
        }
        const tokenPayload = await exchangeCode(code);
        const accessToken = tokenPayload.access_token;
        if (!accessToken) throw new Error('飞书未返回 user_access_token');
        const feishuUser = await getFeishuUser(accessToken);
        const openId = feishuUser.open_id;
        if (!openId) throw new Error('飞书未返回 open_id');

        const tenantAllowed = allowedTenantKeys.size === 0 || allowedTenantKeys.has(feishuUser.tenant_key);
        const departmentIds = [];
        if (tenantAllowed) db.rememberProfile({ openId, name: feishuUser.name || '飞书用户' });
        const member = tenantAllowed ? db.getMember(openId) : null;
        if (!member?.enabled) {
          db.writeAudit({
            ...requestContext(req),
            actor: { openId, name: feishuUser.name || '' },
            action: 'AUTH_LOGIN_DENIED',
            outcome: 'DENIED',
            resourceType: 'auth_session',
            details: { tenantKey: feishuUser.tenant_key || '', departmentIds }
          });
          res.status(403).send('当前飞书账号尚未开通或已停用，请联系管理员在权限管理中搜索你的姓名并开通。');
          return;
        }

        const user = {
          openId,
          unionId: feishuUser.union_id || '',
          userId: feishuUser.user_id || '',
          name: feishuUser.name || '飞书用户',
          avatarUrl: feishuUser.avatar_url || feishuUser.avatar_big || '',
          tenantKey: feishuUser.tenant_key || '',
          departmentIds,
          role: member.role,
          scopes: member.scopes,
          enabled: true,
          accessVersion: member.version,
          loginType: 'feishu'
        };
        if (member.role === 'admin') directoryTokens.set(openId, {
          token: accessToken, expiresAt: Date.now() + Math.min(Number(tokenPayload.expires_in) || 7200, 7200) * 1000
        });
        createSession(res, user);
        db.writeAudit({
          ...requestContext(req),
          actor: user,
          action: 'AUTH_LOGIN_SUCCESS',
          resourceType: 'auth_session',
          details: { loginType: 'feishu', departmentIds }
        });
        res.append('Set-Cookie', cookieText(OAUTH_STATE_COOKIE, '', { maxAge: 0, secure: secureCookie }));
        res.redirect('/');
      } catch (error) {
        db.writeAudit({
          ...requestContext(req),
          action: 'AUTH_LOGIN_FAILED',
          outcome: 'FAILED',
          resourceType: 'auth_session',
          details: { error: error instanceof Error ? error.message : String(error) }
        });
        res.status(401).send(`飞书登录失败：${error instanceof Error ? error.message : String(error)}`);
      }
    });

    app.post('/api/auth/dev-login', (req, res) => {
      if (!devLoginEnabled) {
        res.status(404).json({ success: false, error: '本地验收登录未开启' });
        return;
      }
      const user = {
        openId: 'dev-local-user',
        unionId: '',
        userId: 'dev-local-user',
        name: '本地验收用户',
        avatarUrl: '',
        tenantKey: 'local',
        departmentIds: ['local-development'],
        ...developmentAccess(),
        loginType: 'development'
      };
      createSession(res, user);
      db.writeAudit({
        ...requestContext(req),
        actor: user,
        action: 'AUTH_LOGIN_SUCCESS',
        resourceType: 'auth_session',
        details: { loginType: 'development' }
      });
      res.json({ success: true, user });
    });

    app.post('/api/auth/logout', (req, res) => {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const user = token ? db.getSession(sha256(token)) : null;
      if (user) directoryTokens.delete(user.openId);
      if (token) db.deleteSession(sha256(token));
      clearSession(res);
      db.writeAudit({
        ...requestContext(req),
        actor: user,
        action: 'AUTH_LOGOUT',
        resourceType: 'auth_session'
      });
      res.json({ success: true });
    });
  };

  const requireAuth = (req, res, next) => {
    const user = getUser(req);
    if (!user) {
      res.status(401).json({ success: false, error: '登录已失效，请重新使用飞书登录' });
      return;
    }
    req.authUser = user;
    next();
  };

  const requireEditor = (req, res, next) => {
    if (!isEditor(req.authUser)) {
      db.writeAudit({
        ...requestContext(req),
        action: 'AUTHORIZATION_DENIED',
        outcome: 'DENIED',
        resourceType: 'api_write',
        details: { method: req.method, path: req.originalUrl || req.url || '' }
      });
      res.status(403).json({ success: false, error: '当前账号为换新只读权限，无法修改或保存数据' });
      return;
    }
    next();
  };

  const logoutCurrentSession = (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) db.deleteSession(sha256(token));
    clearSession(res);
  };

  return {
    authConfigured,
    devLoginEnabled,
    getUser,
    registerRoutes,
    requireAuth,
    requireEditor,
    searchDirectory,
    lookupDirectoryUser,
    requestContext,
    logoutCurrentSession
  };
};
