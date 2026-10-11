/**
 * 管理控制台入口：路由与整体布局
 */
import { useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';

import { Layout } from './components/Layout';
import { Button } from './components/ui';
import { useTheme } from './hooks/useTheme';

import { DashboardPage } from './pages/DashboardPage';
import { ConversationsPage } from './pages/ConversationsPage';
import { DebugPage } from './pages/DebugPage';
import { SettingsPage } from './pages/SettingsPage';
import { WeChatPage } from './pages/WeChatPage';
import { LogsPage } from './pages/LogsPage';

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/': { title: '运行概览', subtitle: '服务状态 · AI 提供方 · 微信接入 · 实时统计' },
  '/conversations': { title: '对话记录', subtitle: '按微信用户查看完整对话与上下文状态' },
  '/debug': { title: '调试台', subtitle: '构造请求 · 管线追踪 · 变量观察 · 控制台输出' },
  '/settings': { title: 'API-Key 配置', subtitle: '管理 AI 服务的密钥、模型与对话参数' },
  '/wechat-config': { title: '微信接入', subtitle: '公众号服务器配置与回复策略' },
  '/logs': { title: '运行日志', subtitle: '服务运行事件与错误追踪' },
};

function App() {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [refreshKey, setRefreshKey] = useState(0);

  const meta = PAGE_META[location.pathname] ?? PAGE_META['/'];

  return (
    <Layout
      theme={theme}
      onToggleTheme={toggleTheme}
      title={meta.title}
      subtitle={meta.subtitle}
      actions={
        <Button size="sm" onClick={() => setRefreshKey((key) => key + 1)}>
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </Button>
      }
    >
      <Routes>
        <Route path="/" element={<DashboardPage refreshKey={refreshKey} />} />
        <Route path="/conversations" element={<ConversationsPage refreshKey={refreshKey} />} />
        <Route path="/debug" element={<DebugPage refreshKey={refreshKey} />} />
        <Route path="/settings" element={<SettingsPage refreshKey={refreshKey} />} />
        {/* 注意：路由名不能是 /wechat，该路径已被微信接入端点占用 */}
        <Route path="/wechat-config" element={<WeChatPage refreshKey={refreshKey} />} />
        <Route path="/logs" element={<LogsPage refreshKey={refreshKey} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
