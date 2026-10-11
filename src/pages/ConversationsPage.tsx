/**
 * 对话记录：会话列表 + 消息时间线查看 + 上下文重置
 */
import { useCallback, useEffect, useState } from 'react';
import { Eye, RotateCcw, Search, Trash2, X } from 'lucide-react';
import api, { ApiError } from '../api/client';
import type { ConversationRow, MessageRow } from '../types';
import { Banner, Button, Card, Empty, Input, Spinner, Tag, cn, formatTime } from '../components/ui';

export function ConversationsPage({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<ConversationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const [detail, setDetail] = useState<{ conversation: ConversationRow; messages: MessageRow[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await api.conversations({ limit: 100, q: query || undefined });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await api.conversation(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleReset = async (id: string) => {
    if (!window.confirm('重置将清空该会话的全部上下文（消息记录一并删除），确定继续？')) return;
    setBusyId(id);
    try {
      await api.resetConversation(id);
      await load();
      if (detail?.conversation.id === id) {
        setDetail(await api.conversation(id));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusyId('');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除该会话及其全部消息？')) return;
    setBusyId(id);
    try {
      await api.deleteConversation(id);
      if (detail?.conversation.id === id) setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusyId('');
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('确定清空全部微信会话与消息？该操作不可恢复。')) return;
    try {
      await api.clearConversations();
      setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <>
      {error && <Banner tone="rose">{error}</Banner>}

      <Card
        title={`对话记录（共 ${total} 个会话）`}
        description="每个微信用户对应一个会话，上下文在会话内自动维护"
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={keyword}
                placeholder="搜索 openid / 昵称"
                className="w-[200px] pl-8"
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setQuery(keyword.trim());
                }}
              />
            </div>
            <Button size="sm" onClick={() => setQuery(keyword.trim())}>
              查询
            </Button>
            <Button variant="danger" size="sm" onClick={handleClearAll}>
              清空
            </Button>
          </>
        }
        padded={false}
      >
        {items.length === 0 ? (
          <Empty text="暂无对话记录，可在「消息调试」中模拟一条微信消息" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">用户</th>
                  <th className="px-3 py-2.5 font-medium">渠道</th>
                  <th className="px-3 py-2.5 font-medium">消息数</th>
                  <th className="px-3 py-2.5 font-medium">当前模型</th>
                  <th className="px-3 py-2.5 font-medium">最后消息</th>
                  <th className="px-5 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="max-w-[220px] px-5 py-3">
                      <div className="truncate font-medium text-slate-800 dark:text-slate-200">{item.external_user_id}</div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">
                        {item.last_message || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Tag tone="neutral">{item.channel}</Tag>
                    </td>
                    <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{item.message_count}</td>
                    <td className="px-3 py-3">
                      {item.ai_provider ? (
                        <span className="text-slate-600 dark:text-slate-300">
                          {item.ai_provider}
                          {item.ai_model ? <span className="text-slate-400"> / {item.ai_model}</span> : null}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-500 dark:text-slate-400">{formatTime(item.last_message_at || item.created_at)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => void openDetail(item.id)}>
                          <Eye className="h-3.5 w-3.5" />
                          查看
                        </Button>
                        <Button size="sm" variant="ghost" loading={busyId === item.id} onClick={() => void handleReset(item.id)}>
                          <RotateCcw className="h-3.5 w-3.5" />
                          重置
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void handleDelete(item.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 消息时间线 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-8">
          <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{detail.conversation.external_user_id}</h3>
                <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                  {detail.conversation.channel} · 共 {detail.messages.length} 条消息
                  {detail.conversation.sdk_session_id ? ' · 已绑定 SDK 会话' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-5 py-4 dark:bg-slate-950/40">
              {detailLoading && <Spinner className="mx-auto h-5 w-5 text-slate-400" />}
              {!detailLoading && detail.messages.length === 0 && <Empty text="该会话暂无消息" />}
              {detail.messages.map((message) => (
                <div
                  key={message.id}
                  className={cn('flex flex-col', message.direction === 'in' ? 'items-end' : 'items-start')}
                >
                  <div
                    className={cn(
                      'max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-xs leading-relaxed',
                      message.direction === 'in'
                        ? 'bg-[#07C160] text-white'
                        : message.status === 'error'
                          ? 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
                          : 'border border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200',
                    )}
                  >
                    {message.content}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                    <span>{message.direction === 'in' ? '用户' : 'AI'}</span>
                    <span>{new Date(message.created_at).toLocaleString('zh-CN', { hour12: false })}</span>
                    {message.provider && <span>{message.provider}{message.model ? `/${message.model}` : ''}</span>}
                    {typeof message.latency_ms === 'number' && <span>{message.latency_ms}ms</span>}
                    {message.error && <span className="text-rose-500">{message.error.slice(0, 60)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ConversationsPage;
