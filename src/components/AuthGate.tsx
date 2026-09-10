import React, { createContext, useContext, useEffect, useState } from 'react';
import { AuthUser, developmentLogin, getAuthConfig, getCurrentUser, logout } from '../api';

interface AuthContextValue {
  user: AuthUser;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthGate is missing');
  return value;
};

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [devLoginEnabled, setDevLoginEnabled] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getCurrentUser();
      setUser(result.user);
    } catch {
      const config = await getAuthConfig();
      setDevLoginEnabled(config.devLoginEnabled);
      setAuthConfigured(config.authConfigured);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(err => {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const result = await getCurrentUser();
        if (!cancelled) setUser(previous => (
          previous && JSON.stringify(previous) === JSON.stringify(result.user) ? previous : result.user
        ));
      } catch (err) {
        if (!cancelled && (err as { status?: number }).status === 401) setUser(null);
      } finally { running = false; }
    };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(visible, 15_000);
    window.addEventListener('auth:refresh', refresh);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelled = true; window.clearInterval(timer);
      window.removeEventListener('auth:refresh', refresh); window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [user?.openId]);

  const handleDevLogin = async () => {
    try {
      const result = await developmentLogin();
      setUser(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLogout = async () => {
    await logout();
    window.location.reload();
  };

  if (loading) {
    return <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center text-sm font-bold">正在校验登录状态…</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-6 text-[#141414]">
        <div className="w-full max-w-md border-2 border-[#141414] bg-white">
          <div className="bg-[#141414] px-5 py-4 text-white text-lg font-black">线上竞争追价系统</div>
          <div className="p-7 space-y-4">
            <span className="inline-block border border-[#141414] bg-[#F0EFEC] px-2 py-1 text-xs font-bold">公司内部系统</span>
            <h1 className="text-2xl font-black">使用飞书账号登录</h1>
            <p className="text-sm leading-6 text-[#141414]/70">按人员开通访问。首次登录后，可联系管理员在权限管理中搜索你的姓名并开通。</p>
            {error && <div className="border border-red-700 bg-red-50 p-3 text-xs text-red-800">{error}</div>}
            <a href="/api/auth/login" className="block w-full border-2 border-[#141414] bg-[#141414] px-4 py-3 text-center text-sm font-black text-white">
              {authConfigured ? '飞书授权登录' : '飞书登录待配置'}
            </a>
            {devLoginEnabled && (
              <button onClick={handleDevLogin} className="w-full border-2 border-[#141414] bg-white px-4 py-3 text-sm font-black">本地验收登录</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={{ user, logout: handleLogout }}><React.Fragment key={`${user.openId}:${user.role}:${user.accessVersion}`}>{children}</React.Fragment></AuthContext.Provider>;
}
