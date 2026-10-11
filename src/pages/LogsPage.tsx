/**
 * 运行日志：按级别过滤、查看详情、清空
 */
import { useCallback, useEffect, useState } from 'react';
import api, { ApiError } from '../api/client';
import type { LogRow } from '../types';
import { Banner, Button, Card, Empty, Select, Tag, cn, formatTime, levelTone } from '../components/ui';

const LEVELS = [
  { value: 'all', label: '全部级别' },
  { value: 'debug', label: 'debug' },
  { value: 'info', label: 'info' },
  { value: 'warn', label: 'warn' },
  { value: 'error', label: 'error' },
];

export function LogsPage({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<LogRow[]>([]);
  const [level, setLevel] = useState('all');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await api.logs({ limit: 200, level });
      setItems(data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [level]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleClear = async () => {
    if (!window.confirm('确定要清空全部运行日志吗？')) return;
    setBusy(true);
    try {
      await api.clearLogs();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <Banner tone="rose">{error}</Banner>}

      <Card
        title="运行日志"
        description="记录服务启动、配置变更、微信消息处理与 AI 调用等事件；密钥类字段已自动脱敏"
        actions={
          <>
            <Select value={level} onChange={(event) => setLevel(event.target.value)} className="w-[130px]">
              {LEVELS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
            <Button variant="danger" size="sm" onClick={handleClear} loading={busy}>
              清空
            </Button>
          </>
        }
        padded={false}
      >
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.length === 0 && <Empty text="暂无日志" />}
          {items.map((log) => (
            <div key={log.id}>
              <button
                type="button"
                onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                className={cn(
                  'flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors',
                  log.detail ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50' : 'cursor-default',
                )}
              >
                <Tag tone={levelTone(log.level)}>{log.level}</Tag>
                <span className="w-[92px] shrink-0 truncate text-[11px] text-slate-400 dark:text-slate-500">{log.scope || '-'}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-300">{log.message}</span>
                <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                  {new Date(log.created_at).toLocaleTimeString('zh-CN', { hour12: false })} · {formatTime(log.created_at)}
                </span>
              </button>
              {expanded === log.id && log.detail && (
                <pre className="mx-5 mb-3 overflow-x-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                  {formatDetail(log.detail)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function formatDetail(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

export default LogsPage;
