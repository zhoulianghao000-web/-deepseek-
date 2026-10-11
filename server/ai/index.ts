/**
 * AI 提供方注册表
 *
 * 扩展点：新增提供方后在此处注册即可被控制台自动发现。
 */
import type { AIProvider } from "./types.js";
import type { AppSettings } from "../settings.js";
import { mockProvider } from "./mock.js";
import { openAICompatibleProvider } from "./openai.js";
import { codeBuddyProvider } from "./codebuddy.js";

/** 注册顺序即控制台展示顺序 */
export const providers: AIProvider[] = [codeBuddyProvider, openAICompatibleProvider, mockProvider];

const registry = new Map(providers.map((provider) => [provider.id, provider]));

export function getProvider(id: string): AIProvider | undefined {
  return registry.get(id);
}

/** 解析实际使用的提供方：未配置或不存在时回退到 mock，并返回回退原因 */
export function resolveProvider(settings: AppSettings): { provider: AIProvider; fallback: boolean; reason?: string } {
  const requested = registry.get(settings.ai.provider);
  if (!requested) {
    return { provider: mockProvider, fallback: true, reason: `未知提供方「${settings.ai.provider}」，已回退到 Mock` };
  }
  if (!requested.isConfigured(settings)) {
    return { provider: mockProvider, fallback: true, reason: `${requested.label} 未完成配置，已回退到 Mock` };
  }
  return { provider: requested, fallback: false };
}

/** 提供方清单（含配置状态），供控制台展示 */
export function listProviders(settings: AppSettings) {
  return providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    description: provider.description,
    supportsSessionResume: provider.supportsSessionResume,
    configured: provider.isConfigured(settings),
    configurationHint: provider.configurationHint(),
    active: provider.id === settings.ai.provider,
  }));
}

export type { AIProvider } from "./types.js";
export type { ChatMessage, ChatRequest, ChatResult, ProviderTestResult } from "./types.js";
