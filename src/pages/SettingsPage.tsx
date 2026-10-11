/**
 * API-Key 配置：AI 提供方选择、密钥管理、连通性测试、对话参数
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Cpu, PlugZap, Trash2, XCircle } from 'lucide-react';
import api, { ApiError } from '../api/client';
import type { ProviderInfo, ProviderTestResult, PublicSettings } from '../types';
import { Banner, Button, Card, Field, Input, Spinner, Switch, Tag, Textarea, cn } from '../components/ui';

interface FormState {
  provider: string;
  model: string;
  systemPrompt: string;
  maxContextMessages: number;
  temperature: number;
  cbApiKey: string;
  cbAuthToken: string;
  cbBaseUrl: string;
  cbInternetEnv: string;
  oaApiKey: string;
  oaBaseUrl: string;
  oaModel: string;
}

function toForm(settings: PublicSettings): FormState {
  return {
    provider: settings.ai.provider,
    model: settings.ai.model,
    systemPrompt: settings.ai.systemPrompt,
    maxContextMessages: settings.ai.maxContextMessages,
    temperature: settings.ai.temperature,
    cbApiKey: '',
    cbAuthToken: '',
    cbBaseUrl: settings.codebuddy.baseUrl,
    cbInternetEnv: settings.codebuddy.internetEnv,
    oaApiKey: '',
    oaBaseUrl: settings.openai.baseUrl,
    oaModel: settings.openai.model,
  };
}

export function SettingsPage({ refreshKey }: { refreshKey: number }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await api.settings();
      setSettings(data.settings);
      setProviders(data.providers);
      setForm((prev) => (prev ? { ...prev } : toForm(data.settings)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (error && !form) return <Banner tone="rose">{error}</Banner>;
  if (!form || !settings) {
    return (
      <Card>
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
          <Spinner className="h-4 w-4" />
          正在加载配置…
        </div>
      </Card>
    );
  }

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async (clear: string[] = []) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await api.saveSettings({
        ai: {
          provider: form.provider,
          model: form.model,
          systemPrompt: form.systemPrompt,
          maxContextMessages: Number(form.maxContextMessages) || 12,
          temperature: Number(form.temperature),
        },
        codebuddy: {
          apiKey: form.cbApiKey,
          authToken: form.cbAuthToken,
          baseUrl: form.cbBaseUrl,
          internetEnv: form.cbInternetEnv,
        },
        openai: {
          apiKey: form.oaApiKey,
          baseUrl: form.oaBaseUrl,
          model: form.oaModel,
        },
        clear,
      });
      setSettings(result.settings);
      setProviders(result.providers);
      setForm((prev) => (prev ? { ...prev, ...toForm(result.settings), provider: result.settings.ai.provider } : prev));
      setNotice('配置已保存并立即生效');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (providerId: string) => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      setTestResult(await api.testProvider(providerId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      {error && <Banner tone="rose">{error}</Banner>}
      {notice && <Banner tone="green">{notice}</Banner>}

      <Card
        title="AI 提供方"
        description="选择用于回复微信消息的 AI 服务；未完成配置的提供方发送消息时会自动回退到 Mock"
      >
        <div className="grid gap-3 md:grid-cols-3">
          {providers.map((provider) => {
            const active = form.provider === provider.id;
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => update('provider', provider.id)}
                className={cn(
                  'rounded-xl border p-4 text-left transition-all',
                  active
                    ? 'border-[#07C160] bg-[#07C160]/5 ring-2 ring-[#07C160]/20'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800/40',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{provider.label}</span>
                  <Tag tone={provider.configured ? 'green' : 'amber'}>{provider.configured ? '已配置' : '未配置'}</Tag>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{provider.description}</p>
                {provider.supportsSessionResume && (
                  <div className="mt-2">
                    <Tag tone="blue">支持会话续接</Tag>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            保存配置
          </Button>
          <Button onClick={() => void runTest(form.provider)} loading={testing}>
            <PlugZap className="h-3.5 w-3.5" />
            连通性测试
          </Button>
        </div>

        {testResult && (
          <div className="mt-3">
            <Banner tone={testResult.ok ? 'green' : 'rose'}>
              <span className="inline-flex items-center gap-1.5">
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {testResult.ok ? '连接成功' : '连接失败'}：{testResult.message}（{testResult.latencyMs} ms）
                {testResult.reply ? ` · 返回：${testResult.reply}` : ''}
              </span>
            </Banner>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="CodeBuddy API-Key"
          description="通过 CodeBuddy Agent SDK 调用托管模型（支持会话续接）"
          actions={
            settings.codebuddy.hasApiKey ? (
              <Button size="sm" variant="danger" onClick={() => void save(['codebuddy.apiKey'])}>
                <Trash2 className="h-3.5 w-3.5" />
                清除 Key
              </Button>
            ) : null
          }
        >
          <div className="space-y-3">
            <Field
              label={
                <span className="flex items-center gap-2">
                  API Key
                  <Tag tone={settings.codebuddy.hasApiKey ? 'green' : 'amber'}>
                    {settings.codebuddy.hasApiKey ? settings.codebuddy.apiKeyMasked : '未配置'}
                  </Tag>
                </span>
              }
              hint="留空表示不修改已保存的 Key；也可通过 CODEBUDDY_API_KEY 环境变量提供"
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.cbApiKey}
                placeholder={settings.codebuddy.hasApiKey ? '••••••••（留空不修改）' : '粘贴 CodeBuddy API Key'}
                onChange={(event) => update('cbApiKey', event.target.value)}
              />
            </Field>

            <Field
              label={
                <span className="flex items-center gap-2">
                  Auth Token（可选）
                  <Tag tone={settings.codebuddy.hasAuthToken ? 'green' : 'neutral'}>
                    {settings.codebuddy.hasAuthToken ? settings.codebuddy.authTokenMasked : '未配置'}
                  </Tag>
                </span>
              }
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.cbAuthToken}
                placeholder="留空不修改"
                onChange={(event) => update('cbAuthToken', event.target.value)}
              />
            </Field>

            <Field label="Base URL（可选）" hint="自建/代理网关时填写">
              <Input value={form.cbBaseUrl} placeholder="默认官方地址" onChange={(event) => update('cbBaseUrl', event.target.value)} />
            </Field>

            <Field label="网络环境（可选）" hint="对应 CODEBUDDY_INTERNET_ENVIRONMENT，如 external">
              <Input value={form.cbInternetEnv} placeholder="留空使用默认" onChange={(event) => update('cbInternetEnv', event.target.value)} />
            </Field>
          </div>
        </Card>

        <Card
          title="OpenAI 兼容服务"
          description="任何暴露 /chat/completions 的服务（DeepSeek、Moonshot、Ollama、vLLM…）"
          actions={
            settings.openai.hasApiKey ? (
              <Button size="sm" variant="danger" onClick={() => void save(['openai.apiKey'])}>
                <Trash2 className="h-3.5 w-3.5" />
                清除 Key
              </Button>
            ) : null
          }
        >
          <div className="space-y-3">
            <Field
              label={
                <span className="flex items-center gap-2">
                  API Key
                  <Tag tone={settings.openai.hasApiKey ? 'green' : 'amber'}>
                    {settings.openai.hasApiKey ? settings.openai.apiKeyMasked : '未配置'}
                  </Tag>
                </span>
              }
              hint="留空表示不修改已保存的 Key"
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.oaApiKey}
                placeholder={settings.openai.hasApiKey ? '••••••••（留空不修改）' : 'sk-...'}
                onChange={(event) => update('oaApiKey', event.target.value)}
              />
            </Field>

            <Field label="Base URL" hint="例如 https://api.openai.com/v1 或 https://api.deepseek.com/v1">
              <Input value={form.oaBaseUrl} onChange={(event) => update('oaBaseUrl', event.target.value)} />
            </Field>

            <Field label="默认模型">
              <Input value={form.oaModel} placeholder="gpt-4o-mini" onChange={(event) => update('oaModel', event.target.value)} />
            </Field>
          </div>
        </Card>
      </div>

      <Card
        title="对话参数"
        description="作用于所有通过微信进入的对话"
        actions={
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            <Cpu className="h-3.5 w-3.5" />
            上下文窗口 {form.maxContextMessages} 条
          </span>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="模型 ID" hint="留空使用提供方默认模型">
            <Input value={form.model} placeholder="provider default" onChange={(event) => update('model', event.target.value)} />
          </Field>
          <Field label="上下文消息条数" hint="1 - 50，超出部分自动丢弃">
            <Input
              type="number"
              min={1}
              max={50}
              value={form.maxContextMessages}
              onChange={(event) => update('maxContextMessages', Number(event.target.value))}
            />
          </Field>
          <Field label="Temperature" hint="0 - 2">
            <Input
              type="number"
              step="0.1"
              min={0}
              max={2}
              value={form.temperature}
              onChange={(event) => update('temperature', Number(event.target.value))}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="系统提示词" hint="定义 AI 的表达风格与边界；微信场景建议保持简洁口语化">
            <Textarea
              rows={6}
              value={form.systemPrompt}
              onChange={(event) => update('systemPrompt', event.target.value)}
            />
          </Field>
        </div>
      </Card>
    </>
  );
}

export default SettingsPage;
