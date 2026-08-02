const { URL } = require('url');
const {
  VALID_REASONING_EFFORTS,
  CODEX_PROVIDER_ID,
  configProvider,
  readAuth,
  readConfig,
  readOptional,
  restoreFile,
  writeAuth,
  writeProviderConfig,
} = require('./provider-config.cjs');

function providerId(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return slug || `provider-${Date.now().toString(36)}`;
}

function validateProvider(input, existing, providers) {
  const id = typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : providerId(input?.name || 'provider');
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const baseUrl = typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : '';
  const model = typeof input?.model === 'string' ? input.model.trim() : '';
  const reasoningEffort = typeof input?.reasoningEffort === 'string' ? input.reasoningEffort.trim() : '';
  if (!name) throw new Error('请输入提供商名称。');
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error('请输入有效的提供商请求地址。'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('提供商请求地址必须使用 HTTP 或 HTTPS。');
  if (!model) throw new Error('请输入默认模型。');
  if (!VALID_REASONING_EFFORTS.has(reasoningEffort)) throw new Error('默认推理强度无效。');
  if (providers.some(item => (typeof input?.id !== 'string' || item.id !== id) && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('提供商名称已存在。');
  }
  if (typeof input?.id !== 'string' && providers.some(item => item.id === id)) {
    throw new Error('提供商名称已存在。');
  }
  return { id, name, baseUrl, model, reasoningEffort, existing };
}

function createProviderManager({ codexHome, providerStore, restart, isBusy = () => false }) {
  function providerMatchesConfig(provider, configProviderValue, config) {
    if (!provider || !configProviderValue) return false;
    return provider.name === configProviderValue.name
      && provider.baseUrl === configProviderValue.baseUrl
      && provider.model === configProviderValue.model
      && provider.reasoningEffort === configProviderValue.reasoningEffort
      && provider.model === (typeof config.model === 'string' ? config.model.trim() : '')
      && provider.reasoningEffort === (typeof config.model_reasoning_effort === 'string' ? config.model_reasoning_effort.trim() : '');
  }

  function normalizeActiveProviderConfig() {
    const loaded = readConfig(codexHome);
    const config = loaded.value || {};
    const activeId = typeof config.model_provider === 'string' ? config.model_provider : '';
    if (!activeId || activeId === CODEX_PROVIDER_ID) return;
    const configured = Array.isArray(config.model_providers) ? {} : (config.model_providers || {});
    const entry = configured[activeId];
    if (!entry || typeof entry !== 'object') return;
    writeProviderConfig(codexHome, {
      id: CODEX_PROVIDER_ID,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : activeId,
      baseUrl: typeof entry.base_url === 'string' ? entry.base_url.trim() : '',
      model: typeof config.model === 'string' ? config.model.trim() : '',
      reasoningEffort: typeof config.model_reasoning_effort === 'string' ? config.model_reasoning_effort.trim() : '',
    });
  }

  normalizeActiveProviderConfig();

  function state() {
    const config = readConfig(codexHome).value || {};
    const auth = readAuth(codexHome).value || {};
    const configured = Array.isArray(config.model_providers) ? {} : (config.model_providers || {});
    const stored = providerStore.list();
    const providers = stored.map(item => ({
      id: item.id,
      name: item.name,
      baseUrl: item.baseUrl,
      model: item.model,
      reasoningEffort: item.reasoningEffort,
      hasApiKey: Boolean(providerStore.getApiKey(item.id)),
    }));
    const activeConfig = configProvider(configured[CODEX_PROVIDER_ID], CODEX_PROVIDER_ID, config);
    const storedActive = activeConfig
      ? stored.find(provider => providerMatchesConfig(provider, activeConfig, config))
      : undefined;
    const activeId = storedActive?.id || activeConfig?.id || (typeof config.model_provider === 'string' ? config.model_provider : '');
    if (activeConfig) {
      const index = providers.findIndex(item => item.id === activeId);
      const merged = {
        ...activeConfig,
        id: activeId,
        hasApiKey: Boolean(providerStore.getApiKey(activeId) || auth.OPENAI_API_KEY),
      };
      if (index >= 0) providers[index] = merged;
      else providers.unshift(merged);
    }
    return {
      activeId,
      model: typeof config.model === 'string' ? config.model.trim() : '',
      reasoningEffort: typeof config.model_reasoning_effort === 'string' ? config.model_reasoning_effort.trim() : '',
      providers,
    };
  }

  function apiKeyFor(id) {
    const saved = providerStore.getApiKey(id);
    if (saved) return saved;
    const config = readConfig(codexHome).value || {};
    const configured = Array.isArray(config.model_providers) ? {} : (config.model_providers || {});
    const activeConfig = configProvider(configured[CODEX_PROVIDER_ID], CODEX_PROVIDER_ID, config);
    const provider = providerStore.get(id);
    if (config.model_provider !== CODEX_PROVIDER_ID
      || (id !== CODEX_PROVIDER_ID && !providerMatchesConfig(provider, activeConfig, config))) return '';
    return typeof readAuth(codexHome).value.OPENAI_API_KEY === 'string'
      ? readAuth(codexHome).value.OPENAI_API_KEY.trim()
      : '';
  }

  function save(input) {
    if (isBusy()) throw new Error('Codex 正在执行任务，请在任务结束后保存提供商。');
    const current = state();
    const existing = current.providers.find(item => item.id === input?.id);
    const normalized = validateProvider(input, existing, current.providers);
    const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : '';
    if (!apiKey && !apiKeyFor(normalized.id)) throw new Error('请输入提供商 API Key。');
    providerStore.save(normalized, apiKey);
    return state();
  }

  async function activate(id) {
    if (isBusy()) throw new Error('Codex 正在执行任务，请在任务结束后切换提供商。');
    const current = state();
    const activeProvider = current.providers.find(item => item.id === current.activeId);
    if (activeProvider && !providerStore.get(activeProvider.id)) {
      const activeKey = apiKeyFor(activeProvider.id);
      if (activeKey) providerStore.save(activeProvider, activeKey);
    }
    const savedProvider = providerStore.get(id);
    const provider = savedProvider
      ? {
          id: savedProvider.id,
          name: savedProvider.name,
          baseUrl: savedProvider.baseUrl,
          model: savedProvider.model,
          reasoningEffort: savedProvider.reasoningEffort,
        }
      : current.providers.find(item => item.id === id);
    if (!provider) throw new Error('提供商不存在。');
    const apiKey = apiKeyFor(id);
    if (!apiKey) throw new Error('该提供商没有可用的 API Key。');
    const configFile = require('./provider-config.cjs').readConfig(codexHome).file;
    const authFile = require('./provider-config.cjs').readAuth(codexHome).file;
    const previousConfig = readOptional(configFile);
    const previousAuth = readOptional(authFile);
    try {
      writeProviderConfig(codexHome, provider);
      writeAuth(codexHome, apiKey);
      if (!await restart()) throw new Error('Codex 正在执行任务，暂时无法重启服务。');
      return state();
    } catch (error) {
      restoreFile(configFile, previousConfig);
      restoreFile(authFile, previousAuth);
      throw error;
    }
  }

  function remove(id) {
    if (isBusy()) throw new Error('Codex 正在执行任务，请在任务结束后删除提供商。');
    const current = state();
    if (current.activeId === id) throw new Error('当前提供商不能删除，请先切换到其他提供商。');
    if (!current.providers.some(item => item.id === id)) throw new Error('提供商不存在。');
    providerStore.remove(id);
    return state();
  }

  return { activate, get: state, remove, save };
}

module.exports = { createProviderManager, providerId, validateProvider };
