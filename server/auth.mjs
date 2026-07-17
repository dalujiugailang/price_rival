import crypto from 'node:crypto';
import tls from 'node:tls';

if (typeof tls.setDefaultCACertificates === 'function') {
  tls.setDefaultCACertificates(tls.rootCertificates);
}

const SESSION_COOKIE = 'price_rival_session';
const OAUTH_STATE_COOKIE = 'price_rival_oauth_state';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

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
  const devLoginEnabled = env.NODE_ENV !== 'production' && env.AUTH_DEV_BYPASS === 'true';
  const secureCookie = appUrl.startsWith('https://');
  const callbackUrl = env.FEISHU_REDIRECT_URI || `${appUrl}/api/auth/feishu/callback`;
  const authConfigured = Boolean(appId && appSecret && (allowedDepartments.size || allowedOpenIds.size));

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
    return token ? db.getSession(sha256(token)) : null;
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
    return tokenPayload.access_token || tokenPayload.data?.access_token;
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
        const accessToken = await exchangeCode(code);
        if (!accessToken) throw new Error('飞书未返回 user_access_token');
        const feishuUser = await getFeishuUser(accessToken);
        const openId = feishuUser.open_id;
        if (!openId) throw new Error('飞书未返回 open_id');

        const tenantAllowed = allowedTenantKeys.size === 0 || allowedTenantKeys.has(feishuUser.tenant_key);
        let departmentIds = [];
        if (!allowedOpenIds.has(openId) && allowedDepartments.size > 0) {
          departmentIds = await getDepartmentIds(openId);
        }
        const departmentAllowed = departmentIds.some(id => allowedDepartments.has(id));
        if (!tenantAllowed || (!allowedOpenIds.has(openId) && !departmentAllowed)) {
          db.writeAudit({
            ...requestContext(req),
            actor: { openId, name: feishuUser.name || '' },
            action: 'AUTH_LOGIN_DENIED',
            outcome: 'DENIED',
            resourceType: 'auth_session',
            details: { tenantKey: feishuUser.tenant_key || '', departmentIds }
          });
          res.status(403).send('当前飞书账号不在竞争追价系统白名单内。');
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
          loginType: 'feishu'
        };
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
    requestContext,
    logoutCurrentSession
  };
};
