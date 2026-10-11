/**
 * 微信接入配置：公众号服务器配置、回复策略与接入指引
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Info, Trash2 } from 'lucide-react';
import api, { ApiError } from '../api/client';
import type { ChannelInfo, PublicSettings, ReplyMode } from '../types';
import { Banner, Button, Card, Field, Input, KeyValue, Select, Spinner, Switch, Tag, Textarea } from '../components/ui';

interface FormState {
  channel: string;
  token: string;
  appId: string;
  appSecret: string;
  replyMode: ReplyMode;
  signatureCheck: boolean;
  welcomeMessage: string;
  contextResetKeywords: string;
}

function toForm(settings: PublicSettings): FormState {
  return {
    channel: settings.wechat.channel,
    token: '',
    appId: settings.wechat.appId,
    appSecret: '',
    replyMode: settings.wechat.replyMode,
    signatureCheck: settings.wechat.signatureCheck,
    welcomeMessage: settings.wechat.welcomeMessage,
    contextResetKeywords: settings.wechat.contextResetKeywords,
  };
}

const REPLY_MODE_HINT: Record<ReplyMode, string> = {
  auto: '有 AppID/AppSecret 时异步推送客服消息，否则退化为被动回复（推荐）',
  passive: '同步等待 AI 结果后直接被动回复；注意微信 5 秒超时限制，AI 较慢时可能被重试',
  async: '立即确认收到，随后通过客服消息异步下发；必须配置 AppID/AppSecret',
};

export function WeChatPage({ refreshKey }: { refreshKey: number }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [endpoint, setEndpoint] = useState(`${window.location.origin}/wechat`);

  const load = useCallback(async () => {
    try {
      setError('');
      const [data, overview] = await Promise.all([api.settings(), api.overview()]);
      setSettings(data.settings);
      setChannels(data.channels);
      setEndpoint(overview.wechat.url);
      setForm((prev) => prev ?? toForm(data.settings));
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
          正在加载微信配置…
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
        wechat: {
          channel: form.channel,
          token: form.token,
          appId: form.appId,
          appSecret: form.appSecret,
          replyMode: form.replyMode,
          signatureCheck: form.signatureCheck,
          welcomeMessage: form.welcomeMessage,
          contextResetKeywords: form.contextResetKeywords,
        },
        clear,
      });
      setSettings(result.settings);
      setForm({ ...form, ...toForm(result.settings), token: '', appSecret: '' });
      setNotice('微信接入配置已保存并立即生效');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {error && <Banner tone="rose">{error}</Banner>}
      {notice && <Banner tone="green">{notice}</Banner>}

      <Card
        title="接入信息"
        description="把下面的服务地址与 Token 填入微信公众号后台「设置与开发 → 基本配置 → 服务器配置」"
        actions={
          <Tag tone={settings.wechat.hasToken ? 'green' : 'amber'}>
            {settings.wechat.hasToken ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
            {settings.wechat.hasToken ? 'Token 已配置' : 'Token 待配置'}
          </Tag>
        }
      >
        <KeyValue label="服务地址 URL">
          <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{endpoint}</code>
        </KeyValue>
        <KeyValue label="消息加密方式">明文模式（安全模式需自行扩展 EncodingAESKey 支持）</KeyValue>
        <KeyValue label="客服消息推送">{settings.wechat.hasAppSecret ? '已具备推送能力' : '缺少 AppSecret'}</KeyValue>
        <KeyValue label="当前渠道">{channels.find((item) => item.id === form.channel)?.label || form.channel}</KeyValue>

        <div className="mt-4 flex items-start gap-2 rounded-xl bg-sky-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            本地开发需要公网可达地址，可用内网穿透工具把本机 {window.location.port || 3000} 端口映射出去，再填入公众号后台。
            配置提交时微信会请求该地址做签名校验，校验逻辑已实现。
          </span>
        </div>
      </Card>

      <Card
        title="公众号参数"
        actions={
          <>
            <Button variant="primary" onClick={() => void save()} loading={saving}>
              保存配置
            </Button>
            {settings.wechat.hasToken && (
              <Button variant="danger" onClick={() => void save(['wechat.token'])}>
                <Trash2 className="h-3.5 w-3.5" />
                清除 Token
              </Button>
            )}
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="接入渠道" hint="可扩展企业微信 / 小程序客服等更多渠道">
            <Select value={form.channel} onChange={(event) => update('channel', event.target.value)}>
              {channels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={
              <span className="flex items-center gap-2">
                Token
                <Tag tone={settings.wechat.hasToken ? 'green' : 'amber'}>
                  {settings.wechat.hasToken ? settings.wechat.tokenMasked : '未配置'}
                </Tag>
              </span>
            }
            hint="与公众号后台填写的 Token 完全一致，用于签名校验；留空不修改"
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={form.token}
              placeholder={settings.wechat.hasToken ? '••••••••（留空不修改）' : '自定义 Token，如 wechat_ai_token'}
              onChange={(event) => update('token', event.target.value)}
            />
          </Field>

          <Field label="AppID" hint="用于获取 access_token 以推送客服消息">
            <Input value={form.appId} placeholder="wx************" onChange={(event) => update('appId', event.target.value)} />
          </Field>

          <Field
            label={
              <span className="flex items-center gap-2">
                AppSecret
                <Tag tone={settings.wechat.hasAppSecret ? 'green' : 'neutral'}>
                  {settings.wechat.hasAppSecret ? settings.wechat.appSecretMasked : '未配置'}
                </Tag>
              </span>
            }
            hint="留空不修改"
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={form.appSecret}
              placeholder={settings.wechat.hasAppSecret ? '••••••••（留空不修改）' : '公众号 AppSecret'}
              onChange={(event) => update('appSecret', event.target.value)}
            />
          </Field>

          <Field label="回复模式" hint={REPLY_MODE_HINT[form.replyMode]}>
            <Select value={form.replyMode} onChange={(event) => update('replyMode', event.target.value as ReplyMode)}>
              <option value="auto">自动（推荐）</option>
              <option value="passive">始终被动回复</option>
              <option value="async">始终异步推送</option>
            </Select>
          </Field>

          <div className="flex items-end pb-1">
            <div className="w-full rounded-lg border border-slate-200 px-3.5 py-3 dark:border-slate-700">
              <Switch
                checked={form.signatureCheck}
                onChange={(checked) => update('signatureCheck', checked)}
                label="启用签名校验"
                hint="生产环境务必开启；本地联调可临时关闭"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="关注欢迎语" hint="用户关注公众号后自动回复的内容">
            <Textarea rows={4} value={form.welcomeMessage} onChange={(event) => update('welcomeMessage', event.target.value)} />
          </Field>
          <Field label="上下文重置关键词" hint="逗号分隔，命中即清空该用户上下文">
            <Textarea rows={4} value={form.contextResetKeywords} onChange={(event) => update('contextResetKeywords', event.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="接入步骤" description="按顺序完成即可让微信用户与 AI 对话">
        <ol className="space-y-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          {[
            '准备一个已认证的微信公众号，进入「设置与开发 → 基本配置」获取 AppID 与 AppSecret。',
            '为本机服务准备公网可达地址（云服务器或内网穿透），例如 https://your-domain.com/wechat。',
            '在上方填写 Token / AppID / AppSecret 并保存，回复模式选择「自动」。',
            '回到公众号后台「服务器配置」：URL 填上方服务地址，Token 与页面填写一致，消息加解密方式选「明文模式」，点击提交。',
            '提交时微信会发起签名校验请求；通过后开启服务器配置，即可用微信向公众号发送消息验证。',
            '在「消息调试」页可先本地验证全链路，无需等待公众号审核与公网配置。',
          ].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#07C160]/10 text-[11px] font-semibold text-[#07834b] dark:bg-[#07C160]/15 dark:text-[#4ade80]">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-4">
          <a
            href="https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Access_Overview.html"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-[#07834b] hover:underline dark:text-[#4ade80]"
          >
            微信公众号接入指南
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </Card>
    </>
  );
}

export default WeChatPage;
