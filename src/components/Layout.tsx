/**
 * 控制台整体框架：左侧导航 + 顶部信息栏
 */
import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  FlaskConical,
  KeyRound,
  LayoutDashboard,
  Menu,
  MessageCircle,
  MessagesSquare,
  Moon,
  ScrollText,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import type { Theme } from '../types';
import { Button, Input, cn } from './ui';
import { getAdminToken, setAdminToken } from '../api/client';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '运行概览', icon: LayoutDashboard, end: true },
  { to: '/conversations', label: '对话记录', icon: MessagesSquare },
  { to: '/debug', label: '调试台', icon: FlaskConical },
  { to: '/settings', label: 'API-Key 配置', icon: KeyRound },
  { to: '/wechat-config', label: '微信接入', icon: MessageCircle },
  { to: '/logs', label: '运行日志', icon: ScrollText },
];

export function Layout({
  theme,
  onToggleTheme,
  title,
  subtitle,
  actions,
  children,
}: {
  theme: Theme;
  onToggleTheme: () => void;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenDraft, setTokenDraft] = useState(getAdminToken());
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // 小屏下切换路由后自动收起抽屉式导航
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen w-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* 移动端遮罩 */}
      {navOpen && (
        <button
          type="button"
          aria-label="关闭导航"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
        />
      )}

      {/* 侧边导航：≥lg 常驻，<lg 抽屉式 */}
      <aside
        className={cn(
          'flex w-[232px] shrink-0 flex-col border-r border-slate-200/80 bg-white transition-transform duration-200 dark:border-slate-800 dark:bg-slate-900',
          'fixed inset-y-0 left-0 z-40 lg:static lg:z-auto lg:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#07C160] text-white">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">微信 AI 接入网关</div>
            <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">Agent Web Console</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-[#07C160]/10 font-medium text-[#07834b] dark:bg-[#07C160]/15 dark:text-[#4ade80]'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/70',
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-100 px-3 py-3 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTokenOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/70"
          >
            <ShieldCheck className="h-4 w-4" />
            管理令牌
            {getAdminToken() ? (
              <span className="ml-auto rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                已设置
              </span>
            ) : (
              <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400 dark:bg-slate-800">
                未设置
              </span>
            )}
          </button>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-4 py-3 sm:px-6 sm:py-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="打开导航"
              onClick={() => setNavOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 lg:hidden dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">{title}</h1>
              {subtitle && <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={onToggleTheme}
              title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto max-w-[1180px] space-y-5">{children}</div>
        </main>
      </div>

      {/* 管理令牌设置 */}
      {tokenOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">管理令牌</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  服务端设置环境变量 <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">ADMIN_TOKEN</code> 后，
                  管理接口需要携带该令牌。令牌仅保存在本机浏览器，不会回传服务端日志。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTokenOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4">
              <Input
                type="password"
                value={tokenDraft}
                placeholder="留空表示不使用令牌"
                onChange={(event) => setTokenDraft(event.target.value)}
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                onClick={() => {
                  setAdminToken('');
                  setTokenDraft('');
                  setTokenOpen(false);
                  window.location.reload();
                }}
              >
                清除
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setAdminToken(tokenDraft.trim());
                  setTokenOpen(false);
                  window.location.reload();
                }}
              >
                保存并刷新
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Layout;
