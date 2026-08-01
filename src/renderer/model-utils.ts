import type { CodexModel } from './types';

export const defaultReasoningEfforts = [
  { reasoningEffort: 'minimal', description: '快速响应，适合简单任务' },
  { reasoningEffort: 'low', description: '轻量推理，适合日常问题' },
  { reasoningEffort: 'medium', description: '平衡速度与推理深度' },
  { reasoningEffort: 'high', description: '深入推理，适合复杂任务' },
  { reasoningEffort: 'xhigh', description: '最大推理深度，耗时更长' },
];

export function customModel(name: string): CodexModel {
  return {
    id: `custom:${name}`,
    model: name,
    displayName: name,
    description: '自定义模型',
    isDefault: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: defaultReasoningEfforts,
  };
}

export function resolveModel(
  models: CodexModel[],
  preferred?: string | null,
  fallbackPreferred?: string | null,
): CodexModel | undefined {
  const preferredName = preferred?.trim() || '';
  const fallbackName = fallbackPreferred?.trim() || '';
  return models.find(model => model.model === preferredName)
    || models.find(model => model.model === fallbackName)
    || (preferredName ? customModel(preferredName) : undefined)
    || (fallbackName ? customModel(fallbackName) : undefined)
    || models.find(model => model.isDefault)
    || models[0];
}

export function resolveReasoningEffort(
  sessionEffort: string | undefined,
  selectedModel: CodexModel | undefined,
): string | undefined {
  return sessionEffort || selectedModel?.defaultReasoningEffort;
}
