const fs = require('fs');
const path = require('path');
const { parse, stringify } = require('smol-toml');

const VALID_REASONING_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);

function filePath(codexHome, name) {
  return path.join(codexHome, name);
}

function readOptional(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, file);
}

function restoreFile(file, previous) {
  if (previous === null) {
    try { fs.unlinkSync(file); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    return;
  }
  writeAtomic(file, previous);
}

function readConfig(codexHome) {
  const file = filePath(codexHome, 'config.toml');
  const source = readOptional(file);
  return { file, source, value: source === null ? {} : parse(source) };
}

function readAuth(codexHome) {
  const file = filePath(codexHome, 'auth.json');
  const source = readOptional(file);
  let value = {};
  if (source !== null) {
    try {
      value = JSON.parse(source);
    } catch {
      throw new Error('Codex auth.json 格式无效。');
    }
  }
  return { file, source, value: value && typeof value === 'object' && !Array.isArray(value) ? value : {} };
}

function configProvider(value, id, config) {
  const entry = config?.model_providers?.[id];
  if (!entry || typeof entry !== 'object') return null;
  return {
    id,
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id,
    baseUrl: typeof entry.base_url === 'string' ? entry.base_url.trim() : '',
    model: id === config.model_provider && typeof config.model === 'string' ? config.model.trim() : '',
    reasoningEffort: id === config.model_provider && typeof config.model_reasoning_effort === 'string'
      ? config.model_reasoning_effort.trim()
      : '',
  };
}

function writeProviderConfig(codexHome, provider) {
  const loaded = readConfig(codexHome);
  const config = loaded.value && typeof loaded.value === 'object' ? loaded.value : {};
  config.model_provider = provider.id;
  config.model = provider.model;
  config.model_reasoning_effort = provider.reasoningEffort;
  config.model_providers = config.model_providers && typeof config.model_providers === 'object'
    ? config.model_providers
    : {};
  config.model_providers[provider.id] = {
    ...(config.model_providers[provider.id] || {}),
    name: provider.name,
    wire_api: 'responses',
    requires_openai_auth: true,
    base_url: provider.baseUrl,
  };
  writeAtomic(loaded.file, stringify(config));
  return loaded;
}

function writeAuth(codexHome, apiKey) {
  const loaded = readAuth(codexHome);
  writeAtomic(loaded.file, JSON.stringify({ ...loaded.value, OPENAI_API_KEY: apiKey }, null, 2));
  return loaded;
}

module.exports = {
  VALID_REASONING_EFFORTS,
  configProvider,
  readAuth,
  readConfig,
  readOptional,
  restoreFile,
  writeAuth,
  writeProviderConfig,
};
