function finiteNumber(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function pick(value, camelCase, snakeCase) {
  return value?.[camelCase] ?? value?.[snakeCase];
}

function normalizeBreakdown(value) {
  if (!value || typeof value !== 'object') return null;
  const totalTokens = finiteNumber(pick(value, 'totalTokens', 'total_tokens'));
  if (totalTokens === undefined) return null;
  return {
    cachedInputTokens: finiteNumber(pick(value, 'cachedInputTokens', 'cached_input_tokens')) || 0,
    inputTokens: finiteNumber(pick(value, 'inputTokens', 'input_tokens')) || 0,
    outputTokens: finiteNumber(pick(value, 'outputTokens', 'output_tokens')) || 0,
    reasoningOutputTokens: finiteNumber(pick(value, 'reasoningOutputTokens', 'reasoning_output_tokens')) || 0,
    totalTokens,
  };
}

function normalizeTokenUsage(value, reportedAt = Date.now()) {
  if (!value || typeof value !== 'object') return null;
  const last = normalizeBreakdown(value.last || value.lastTokenUsage || value.last_token_usage);
  const total = normalizeBreakdown(value.total || value.totalTokenUsage || value.total_token_usage);
  if (!last || !total) return null;
  const contextWindow = finiteNumber(pick(value, 'modelContextWindow', 'model_context_window'));
  return {
    last,
    total,
    modelContextWindow: contextWindow === undefined ? null : contextWindow,
    reportedAt,
  };
}

function tokenUsageFromThread(thread, reportedAt = Date.now()) {
  return normalizeTokenUsage(thread?.tokenUsage || thread?.token_usage, reportedAt);
}

module.exports = { normalizeTokenUsage, tokenUsageFromThread };
