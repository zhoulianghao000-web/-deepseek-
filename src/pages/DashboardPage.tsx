/**
 * 运行概览：服务状态、AI 提供方、微信接入、实时统计与最近动态
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import api, { ApiError } from '../api/client';
import type { Overview } from '../types';
import { Banner, Card, Empty, KeyValue, StatCard, Tag, formatDuration, formatTime, levelTone } from '../components/ui';

export function DashboardPage({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api.overview());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (error) return <Banner tone="rose">{error}</Banner>;
  if (!data) return <Card><Empty text="正在加载运行状态…" /></Card>;

  const { server, ai, wechat, stats } = data;

  return (
    <>
      {ai.fallback && (
        <Banner tone="amber">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            当前配置的提供方「{ai.providerLabel}」不可用，实际生效为「{ai.effectiveProviderLabel}」。
            {ai.fallbackReason ? ` 原因：${ai.fallbackReason}` : ''}
          </span>
        </Banner>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="微信会话" value={stats.conversations} hint={`收到 ${stats.inbound} 条 · 回复 ${stats.outbound} 条`} tone="green" />
        <StatCard label="消息总数" value={stats.messages} hint="含用户消息与助手回复" tone="blue" />
        <StatCard label="近 24 小时消息" value={stats.messages24h} hint="用于观察实时活跃度" tone="violet" />
        <StatCard label="错误日志" value={stats.errors} hint="error 级别累计" tone={stats.errors > 0 ? 'rose' : 'neutral'} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="AI 服务状态" description="当前生效的对话提供方与对话参数">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Tag tone={ai.fallback ? 'amber' : 'green'}>
              {ai.fallback ? <AlertTriangle className="mr-1 h-3 w-3" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
              生效：{ai.effectiveProviderLabel}
            </Tag>
            <Tag tone="neutral">模型：{ai.model}</Tag>
            <Tag tone="neutral">上下文：{ai.contextWindow} 条</Tag>
            <Tag tone="neutral">temperature：{ai.temperature}</Tag>
          </div>
          <KeyValue label="配置的提供方">{ai.providerLabel}</KeyValue>
          <KeyValue label="支持会话续接">{ai.providers.find((p) => p.id === ai.effectiveProvider)?.supportsSessionResume ? '是' : '否'}</KeyValue>
          <KeyValue label="可用提供方">
            <span className="flex flex-wrap justify-end gap-1.5">
              {ai.providers.map((provider) => (
                <Tag key={provider.id} tone={provider.configured ? 'green' : 'neutral'}>
                  {provider.label}
                  {provider.configured ? '' : '（未配置）'}
                </Tag>
              ))}
            </span>
          </KeyValue>
        </Card>

        <Card title="微信接入状态" description="公众号服务器配置与回复策略">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Tag tone={wechat.configured ? 'green' : 'amber'}>
              {wechat.configured ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
              {wechat.configured ? '已配置' : '待配置'}
            </Tag>
            <Tag tone="neutral">{wechat.channelLabel}</Tag>
            <Tag tone={wechat.signatureCheck ? 'green' : 'amber'}>{wechat.signatureCheck ? '签名校验开启' : '签名校验关闭'}</Tag>
          </div>
          <KeyValue label="接入地址（URL）">
            <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{wechat.url}</code>
          </KeyValue>
          <KeyValue label="回复模式">
            {wechat.replyMode === 'auto' ? '自动' : wechat.replyMode === 'passive' ? '被动回复' : '异步推送'}
          </KeyValue>
          <KeyValue label="客服消息推送">{wechat.canPush ? '可用' : '不可用（缺少 AppID/AppSecret）'}</KeyValue>
          <KeyValue label="AppID">{wechat.appId || '未配置'}</KeyValue>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="服务运行信息" description="进程与端口">
          <KeyValue label="运行时长">{formatDuration(server.uptimeSec)}</KeyValue>
          <KeyValue label="启动时间">{new Date(server.startedAt).toLocaleString('zh-CN', { hour12: false })}</KeyValue>
          <KeyValue label="Node 版本">{server.node}</KeyValue>
          <KeyValue label="进程 PID">{server.pid}</KeyValue>
          <KeyValue label="服务端口">{server.port}</KeyValue>
          <KeyValue label="管理令牌">{server.adminTokenEnabled ? '已启用（需携带 x-admin-token）' : '未启用'}</KeyValue>
        </Card>

        <Card title="最近会话" description="按最后一条消息时间排序" padded={false}>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.recentConversations.length === 0 && <Empty text="暂无对话，去「消息调试」发一条试试" />}
            {data.recentConversations.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">{item.external_user_id}</div>
                  <div className="mt-1 line-clamp-1 text-[11px] text-slate-400 dark:text-slate-500">{item.last_message || '—'}</div>
                </div>
                <div className="shrink-0 text-right">
                  <Tag tone="neutral">{item.message_count} 条</Tag>
                  <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{formatTime(item.last_message_at || item.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="最近日志" description="实时运行事件" padded={false}>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.recentLogs.length === 0 && <Empty text="暂无日志" />}
          {data.recentLogs.map((log) => (
            <div key={log.id} className="flex items-start gap-3 px-5 py-2.5">
              <Tag tone={levelTone(log.level)}>{log.level}</Tag>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-slate-700 dark:text-slate-300">{log.message}</div>
                <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                  {log.scope} · {formatTime(log.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

export default DashboardPage;
