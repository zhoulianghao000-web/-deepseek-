/**
 * 调试台（开发阶段功能验证页）
 *
 * 三栏结构：
 *   ① 构造请求 —— 模拟微信入站消息，可临时覆盖 AI 参数（不落库）
 *   ② 请求记录 —— 管线逐阶段追踪 + 响应原文 + 等价 cURL，便于检查元素与复现
 *   ③ 观察面板 —— 实时状态、变量观察、浏览器控制台输出捕获
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Eraser, RotateCcw, Send, Terminal } from 'lucide-react';
import api, { ApiError } from '../api/client';
import type { Overview, PlaygroundResult, TraceStep } from '../types';
import {
  Banner,
  Button,
  Card,
  Empty,
  Field,
  Input,
  KeyValue,
  Select,
  Spinner,
  Switch,
  Tag,
  Textarea,
  cn,
  formatDuration,
} from '../components/ui';

/** 快捷指令：覆盖普通对话、指令、兜底等不同分支 */
const QUICK_PROMPTS = ['你好，介绍一下你自己', '帮助', '重置', 'ping'];

interface ConsoleEntry {
  id: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
  at: Date;
}

interface DebugRecord {
  id: number;
  at: Date;
  text: string;
  payload: Record<string, unknown>;
  pending: boolean;
  result?: PlaygroundResult;
  error?: string;
}

let recordSeq = 0;
let consoleSeq = 0;

function formatArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 捕获浏览器控制台输出，便于在页面内直接观察（不影响原生输出） */
function useConsoleCapture(enabled: boolean) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const originalsRef = useRef<Record<string, (...args: unknown[]) => void> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (originalsRef.current) return; // 已接管（兼容 StrictMode 的重复挂载）

    const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const originals: Record<string, (...args: unknown[]) => void> = {};
    levels.forEach((level) => {
      originals[level] = console[level].bind(console) as (...args: unknown[]) => void;
      console[level] = ((...args: unknown[]) => {
        originals[level](...args);
        setEntries((prev) => [
          ...prev.slice(-149),
          { id: ++consoleSeq, level, text: args.map(formatArg).join(' '), at: new Date() },
        ]);
      }) as typeof console.log;
    });
    originalsRef.current = originals;

    const onError = (event: ErrorEvent) => {
      setEntries((prev) => [
        ...prev.slice(-149),
        { id: ++consoleSeq, level: 'error', text: `${event.message} @ ${event.filename}:${event.lineno}`, at: new Date() },
      ]);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      setEntries((prev) => [
        ...prev.slice(-149),
        { id: ++consoleSeq, level: 'error', text: `未处理的 Promise 拒绝：${formatArg(event.reason)}`, at: new Date() },
      ]);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      if (originalsRef.current) {
        levels.forEach((level) => {
          console[level] = originalsRef.current![level] as typeof console.log;
        });
        originalsRef.current = null;
      }
    };
  }, [enabled]);

  const clear = useCallback(() => setEntries([]), []);
  return { entries, clear };
}

/** 管线追踪可视化 */
function TraceList({ trace }: { trace: TraceStep[] }) {
  const maxDuration = useMemo(() => Math.max(...trace.map((step) => step.durationMs), 1), [trace]);
  return (
    <ol className="space-y-1.5" data-debug="trace">
      {trace.map((step, index) => (
        <li key={`${step.step}-${index}`} className="text-[11px]">
          <div className="flex items-center gap-2">
            <span
              className={cn('h-1.5 w-1.5 shrink-0 rounded-full', step.ok ? 'bg-emerald-500' : 'bg-rose-500')}
              title={step.ok ? '正常' : '失败'}
            />
            <span className="w-[68px] shrink-0 font-medium text-slate-700 dark:text-slate-200">{step.label}</span>
            <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400" title={step.detail}>
              {step.detail || '—'}
            </span>
            <span className="w-[52px] shrink-0 text-right font-mono text-slate-400 dark:text-slate-500">
              {step.durationMs}ms
            </span>
          </div>
          <div className="ml-[76px] mt-1 h-1 w-[calc(100%-76px)] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className={cn('h-full rounded-full', step.ok ? 'bg-emerald-400' : 'bg-rose-400')}
              style={{ width: `${Math.max(3, Math.round((step.durationMs / maxDuration) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function CodeBlock({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="mt-2 max-h-[260px] overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-950 dark:text-slate-400">
      {text}
    </pre>
  );
}

export function DebugPage({ refreshKey }: { refreshKey: number }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState('');

  // 请求构造器
  const [channel, setChannel] = useState('official_account');
  const [externalUserId, setExternalUserId] = useState('debug-user-001');
  const [text, setText] = useState('你好，请用一句话介绍你自己');

  // 参数覆盖（仅本次生效）
  const [overridesEnabled, setOverridesEnabled] = useState(false);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [maxContextMessages, setMaxContextMessages] = useState('12');
  const [temperature, setTemperature] = useState('');

  // 记录与面板
  const [records, setRecords] = useState<DebugRecord[]>([]);
  const [sending, setSending] = useState(false);
  const [captureConsole, setCaptureConsole] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [lastPayload, setLastPayload] = useState<Record<string, unknown> | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const { entries: consoleEntries, clear: clearConsole } = useConsoleCapture(captureConsole);

  const loadOverview = useCallback(async () => {
    try {
      setLoadError('');
      setOverview(await api.overview());
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, refreshKey]);

  useEffect(() => {
    if (overview) setChannel((prev) => prev || overview.wechat.channel);
  }, [overview]);

  useEffect(() => {
    if (!autoScroll) return;
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0 }));
  }, [records.length, autoScroll]);

  const buildPayload = useCallback(
    (content: string): Record<string, unknown> => {
      const payload: Record<string, unknown> = {
        text: content,
        externalUserId: externalUserId.trim() || 'debug-user-001',
        channel,
      };
      if (overridesEnabled) {
        if (provider) payload.provider = provider;
        if (model.trim()) payload.model = model.trim();
        if (systemPrompt.trim()) payload.systemPrompt = systemPrompt.trim();
        if (maxContextMessages !== '' && Number.isFinite(Number(maxContextMessages))) {
          payload.maxContextMessages = Number(maxContextMessages);
        }
        if (temperature !== '' && Number.isFinite(Number(temperature))) payload.temperature = Number(temperature);
      }
      return payload;
    },
    [channel, externalUserId, maxContextMessages, model, overridesEnabled, provider, systemPrompt, temperature],
  );

  const send = useCallback(
    async (content: string) => {
      const value = content.trim();
      if (!value || sending) return;

      const payload = buildPayload(value);
      const id = ++recordSeq;
      const record: DebugRecord = { id, at: new Date(), text: value, payload, pending: true };
      setRecords((prev) => [record, ...prev]);
      setLastPayload(payload);
      setSending(true);

      try {
        const result = await api.playground(payload as any);
        setRecords((prev) => prev.map((item) => (item.id === id ? { ...item, pending: false, result } : item)));
        if (result.error) {
          console.error('[调试台] 调用返回错误状态', { kind: result.kind, error: result.error });
        } else {
          console.info('[调试台] 调用完成', {
            kind: result.kind,
            provider: result.provider,
            model: result.model,
            latencyMs: result.latencyMs,
            totalMs: result.totalMs,
          });
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err);
        setRecords((prev) => prev.map((item) => (item.id === id ? { ...item, pending: false, error: message } : item)));
        console.error('[调试台] 请求失败', message);
      } finally {
        setSending(false);
        void loadOverview();
      }
    },
    [buildPayload, loadOverview, sending],
  );

  const copyCurl = useCallback(async (record: DebugRecord) => {
    const curl = [
      `curl -X POST '${window.location.origin}/api/admin/playground'`,
      `  -H 'Content-Type: application/json'`,
      `  -d '${JSON.stringify(record.payload)}'`,
    ].join(' \\\n');
    try {
      await navigator.clipboard.writeText(curl);
      setCopiedId(record.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      console.warn('[调试台] 剪贴板不可用，请手动复制');
    }
  }, []);

  const lastResult = records.find((item) => item.result)?.result;

  return (
    <>
      {loadError && <Banner tone="rose">{loadError}</Banner>}

      <Card
        title="调试台"
        description="构造一条模拟的微信入站消息，观察处理管线每一步的耗时与结果；所有参数调整仅作用于本次调用，不会写回配置"
        actions={
          <>
            <Switch checked={captureConsole} onChange={setCaptureConsole} label="捕获控制台" />
            <Switch checked={autoScroll} onChange={setAutoScroll} label="自动置顶" />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>
            端点：<code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">POST /api/admin/playground</code>
          </span>
          <span>
            生效提供方：
            <Tag tone="green">{overview?.ai.effectiveProviderLabel ?? '加载中'}</Tag>
          </span>
          <span>
            上下文窗口：<b className="text-slate-700 dark:text-slate-200">{overview?.ai.contextWindow ?? '-'}</b> 条
          </span>
          <span>
            当前会话数：<b className="text-slate-700 dark:text-slate-200">{overview?.stats.conversations ?? '-'}</b>
          </span>
          <span>
            消息总数：<b className="text-slate-700 dark:text-slate-200">{overview?.stats.messages ?? '-'}</b>
          </span>
        </div>
      </Card>

      <div className="flex flex-col gap-5 xl:flex-row">
        {/* ============ ① 构造请求 ============ */}
        <div className="space-y-5 xl:w-[350px] xl:shrink-0" data-debug="request-builder">
          <Card title="① 构造请求" description="模拟微信入站消息">
            <div className="space-y-3">
              <Field label="接入渠道">
                <Select value={channel} onChange={(event) => setChannel(event.target.value)}>
                  {(overview?.channels ?? [{ id: 'official_account', label: '微信公众号', description: '' }]).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="模拟用户标识（openid）" hint="换一个 openid 即可验证会话隔离与上下文互不影响">
                <div className="flex gap-2">
                  <Input value={externalUserId} onChange={(event) => setExternalUserId(event.target.value)} />
                  <Button
                    size="sm"
                    title="随机生成一个用户标识"
                    onClick={() => setExternalUserId(`debug-user-${Math.random().toString(36).slice(2, 8)}`)}
                  >
                    随机
                  </Button>
                </div>
              </Field>

              <Field label="消息内容" hint="Ctrl / ⌘ + Enter 快速发送">
                <Textarea
                  rows={3}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      void send(text);
                    }
                  }}
                />
              </Field>

              <div className="flex flex-wrap gap-1.5">
                {QUICK_PROMPTS.map((item) => (
                  <Button key={item} size="sm" variant="ghost" onClick={() => setText(item)} disabled={sending}>
                    {item}
                  </Button>
                ))}
              </div>

              <Button variant="primary" className="w-full" loading={sending} onClick={() => void send(text)}>
                <Send className="h-3.5 w-3.5" />
                发送并观察
              </Button>
            </div>
          </Card>

          <Card
            title="② 参数覆盖"
            description="仅作用于本次调用，不写回数据库"
            actions={<Switch checked={overridesEnabled} onChange={setOverridesEnabled} />}
          >
            <div className={cn('space-y-3', !overridesEnabled && 'pointer-events-none opacity-40')}>
              <Field label="提供方" hint="选择「跟随当前配置」则使用控制台已保存的设置">
                <Select value={provider} onChange={(event) => setProvider(event.target.value)}>
                  <option value="">跟随当前配置</option>
                  {(overview?.ai.providers ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                      {item.configured ? '' : '（未配置）'}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="模型" hint="留空使用提供方默认模型">
                <Input value={model} placeholder="例如 claude-sonnet-4" onChange={(event) => setModel(event.target.value)} />
              </Field>
              <Field label="上下文条数" hint="1 - 50">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={maxContextMessages}
                  onChange={(event) => setMaxContextMessages(event.target.value)}
                />
              </Field>
              <Field label="Temperature" hint="0 - 2，留空使用当前配置">
                <Input
                  type="number"
                  step={0.1}
                  min={0}
                  max={2}
                  value={temperature}
                  placeholder={String(overview?.ai.temperature ?? 0.7)}
                  onChange={(event) => setTemperature(event.target.value)}
                />
              </Field>
              <Field label="系统提示词" hint="留空使用当前配置">
                <Textarea
                  rows={3}
                  value={systemPrompt}
                  placeholder="例如：你是一个只回答天气的助手"
                  onChange={(event) => setSystemPrompt(event.target.value)}
                />
              </Field>
            </div>
          </Card>
        </div>

        {/* ============ ③ 请求记录 ============ */}
        <div className="min-w-0 flex-1 space-y-4" data-debug="records">
          <Card
            title="③ 请求记录"
            description="每条记录包含请求体、管线逐阶段追踪、响应与原始报文"
            actions={
              <Button size="sm" variant="ghost" onClick={() => setRecords([])} disabled={records.length === 0}>
                <Eraser className="h-3.5 w-3.5" />
                清空记录
              </Button>
            }
            padded={false}
          >
            <div ref={listRef} className="max-h-[620px] space-y-4 overflow-y-auto px-5 py-4">
              {records.length === 0 && <Empty text="尚未发送请求。填入内容后点击「发送并观察」" />}

              {records.map((record) => (
                <article
                  key={record.id}
                  data-debug="record"
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40"
                >
                  {/* 记录头 */}
                  <header className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">#{record.id}</span>
                    <span>{record.at.toLocaleTimeString('zh-CN', { hour12: false })}</span>
                    <span className="truncate">openid: {String(record.payload.externalUserId)}</span>
                    {record.result && <Tag tone={resultTone(record.result.kind)}>{record.result.kind}</Tag>}
                    {record.result && <Tag tone="neutral">{record.result.totalMs ?? record.result.latencyMs} ms</Tag>}
                    {record.pending && <Spinner className="h-3 w-3" />}
                    <button
                      type="button"
                      onClick={() => void copyCurl(record)}
                      className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors hover:bg-slate-200/70 dark:hover:bg-slate-800"
                    >
                      {copiedId === record.id ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      {copiedId === record.id ? '已复制' : '复制 cURL'}
                    </button>
                  </header>

                  {/* 用户消息 */}
                  <div className="mt-3 flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-[#07C160] px-4 py-2.5 text-xs leading-relaxed text-white">
                      {record.text}
                    </div>
                  </div>

                  {/* 管线追踪 */}
                  {record.result?.trace && record.result.trace.length > 0 && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
                      <div className="mb-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200">处理管线</div>
                      <TraceList trace={record.result.trace} />
                    </div>
                  )}

                  {/* 响应 */}
                  {record.pending && (
                    <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
                      <Spinner className="h-3.5 w-3.5" />
                      正在处理…
                    </div>
                  )}

                  {record.result && (
                    <div className="mt-3 space-y-2">
                      <div className="flex justify-start">
                        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                          {record.result.reply}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <Tag tone="blue">
                          {record.result.provider}
                          {record.result.model ? ` / ${record.result.model}` : ''}
                        </Tag>
                        <Tag tone="violet">AI 耗时 {record.result.latencyMs} ms</Tag>
                        <Tag tone="neutral">会话 {record.result.conversationId.slice(0, 8)}</Tag>
                        {record.result.fallback && <Tag tone="amber">已回退：{record.result.fallbackReason}</Tag>}
                      </div>
                    </div>
                  )}

                  {record.error && <Banner tone="rose">{record.error}</Banner>}

                  {/* 原始报文 */}
                  <div className="mt-3 space-y-1">
                    <details className="text-[11px] text-slate-500 dark:text-slate-400">
                      <summary className="cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200">
                        请求体（JSON）
                      </summary>
                      <CodeBlock value={record.result?.request?.payload ?? record.payload} />
                    </details>
                    <details className="text-[11px] text-slate-500 dark:text-slate-400">
                      <summary className="cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200">
                        原始响应（JSON）
                      </summary>
                      <CodeBlock value={record.result ?? { error: record.error ?? '处理中' }} />
                    </details>
                  </div>
                </article>
              ))}
            </div>
          </Card>
        </div>

        {/* ============ ④ 观察面板 ============ */}
        <div className="space-y-5 xl:w-[330px] xl:shrink-0" data-debug="inspector">
          <Card title="实时状态" description="来自 /api/admin/overview" actions={
            <Button size="sm" variant="ghost" onClick={() => void loadOverview()}>
              <RotateCcw className="h-3.5 w-3.5" />
              刷新
            </Button>
          }>
            {overview ? (
              <>
                <KeyValue label="生效提供方">
                  <Tag tone={overview.ai.fallback ? 'amber' : 'green'}>{overview.ai.effectiveProviderLabel}</Tag>
                </KeyValue>
                <KeyValue label="配置提供方">{overview.ai.providerLabel}</KeyValue>
                <KeyValue label="模型">{overview.ai.model}</KeyValue>
                <KeyValue label="上下文窗口">{overview.ai.contextWindow} 条</KeyValue>
                <KeyValue label="temperature">{overview.ai.temperature}</KeyValue>
                <KeyValue label="微信接入">
                  <Tag tone={overview.wechat.configured ? 'green' : 'amber'}>
                    {overview.wechat.configured ? '已配置' : '待配置'}
                  </Tag>
                </KeyValue>
                <KeyValue label="回复模式">{overview.wechat.replyMode}</KeyValue>
                <KeyValue label="运行时长">{formatDuration(overview.server.uptimeSec)}</KeyValue>
                <KeyValue label="消息 / 会话">
                  {overview.stats.messages} / {overview.stats.conversations}
                </KeyValue>
                <KeyValue label="错误日志">
                  <Tag tone={overview.stats.errors > 0 ? 'rose' : 'neutral'}>{overview.stats.errors}</Tag>
                </KeyValue>
              </>
            ) : (
              <Empty text="加载中…" />
            )}
          </Card>

          <Card title="变量观察" description="最近一次调用的响应字段">
            {lastResult ? (
              <>
                <KeyValue label="kind">
                  <Tag tone={resultTone(lastResult.kind)}>{lastResult.kind}</Tag>
                </KeyValue>
                <KeyValue label="conversationId">
                  <code className="text-[10px]">{lastResult.conversationId}</code>
                </KeyValue>
                <KeyValue label="provider / model">{`${lastResult.provider} / ${lastResult.model || '-'}`}</KeyValue>
                <KeyValue label="AI 耗时">{lastResult.latencyMs} ms</KeyValue>
                <KeyValue label="接口总耗时">{lastResult.totalMs ?? '-'} ms</KeyValue>
                <KeyValue label="回复长度">{lastResult.reply.length} 字</KeyValue>
                <KeyValue label="管线阶段数">{lastResult.trace?.length ?? 0}</KeyValue>
                <KeyValue label="是否回退">{lastResult.fallback ? '是' : '否'}</KeyValue>
                {lastResult.error && (
                  <div className="mt-3">
                    <Banner tone="rose">{lastResult.error}</Banner>
                  </div>
                )}
              </>
            ) : (
              <Empty text="发送一次请求后显示" />
            )}

            {lastPayload && (
              <details className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                <summary className="cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200">
                  最近一次请求体
                </summary>
                <CodeBlock value={lastPayload} />
              </details>
            )}
          </Card>

          <Card
            title="浏览器控制台"
            description="捕获 console 与运行时错误"
            actions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    console.info('[调试台] 手动测试日志', { at: new Date().toISOString() });
                    console.warn('[调试台] 这是一条 warn 示例');
                  }}
                >
                  <Terminal className="h-3.5 w-3.5" />
                  测试
                </Button>
                <Button size="sm" variant="ghost" onClick={clearConsole} disabled={consoleEntries.length === 0}>
                  <Eraser className="h-3.5 w-3.5" />
                </Button>
              </>
            }
            padded={false}
          >
            <div className="max-h-[280px] overflow-y-auto px-4 py-3" data-debug="console">
              {consoleEntries.length === 0 && <Empty text="暂无输出" />}
              <ul className="space-y-1.5">
                {consoleEntries.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2 text-[11px]">
                    <Tag tone={consoleTone(entry.level)}>{entry.level}</Tag>
                    <span className="min-w-0 flex-1 break-words text-slate-600 dark:text-slate-300">{entry.text}</span>
                    <span className="shrink-0 font-mono text-slate-400 dark:text-slate-500">
                      {entry.at.toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card title="本页用到的接口" description="便于对照 Network 面板排查">
            <ul className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
              {[
                ['GET', '/api/admin/overview', '实时状态与统计'],
                ['POST', '/api/admin/playground', '模拟入站消息，走完整管线'],
                ['GET', '/api/admin/conversations', '核对消息是否落库'],
              ].map(([method, path, note]) => (
                <li key={path} className="flex items-start gap-2">
                  <Tag tone={method === 'GET' ? 'blue' : 'green'}>{method}</Tag>
                  <code className="min-w-0 break-all">{path}</code>
                  <span className="shrink-0 text-slate-400 dark:text-slate-500">{note}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function resultTone(kind: string) {
  if (kind === 'error') return 'rose' as const;
  if (kind === 'reply') return 'green' as const;
  if (kind === 'duplicate' || kind === 'ignored') return 'amber' as const;
  return 'violet' as const;
}

function consoleTone(level: ConsoleEntry['level']) {
  if (level === 'error') return 'rose' as const;
  if (level === 'warn') return 'amber' as const;
  if (level === 'info') return 'blue' as const;
  return 'neutral' as const;
}

export default DebugPage;
