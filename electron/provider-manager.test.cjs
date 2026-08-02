const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProviderManager } = require('./provider-manager.cjs');
const { createProviderStore } = require('./provider-store.cjs');

function createFixture(config, auth = { OPENAI_API_KEY: 'current-key' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-provider-'));
  fs.writeFileSync(path.join(root, 'config.toml'), config);
  fs.writeFileSync(path.join(root, 'auth.json'), JSON.stringify(auth));
  const providerStore = createProviderStore(path.join(root, 'providers.json'), {
    encryptString: value => Buffer.from(`encrypted:${value}`),
    decryptString: value => Buffer.from(value).toString('utf8').replace(/^encrypted:/, ''),
  });
  return { root, providerStore };
}

const customConfig = [
  'model_provider = "custom"',
  'model = "gpt-5.6-luna"',
  'model_reasoning_effort = "high"',
  'unknown_setting = "preserve me"',
  '',
  '[model_providers.custom]',
  'name = "custom"',
  'wire_api = "responses"',
  'requires_openai_auth = true',
  'base_url = "https://sub.pikaqiu.shop"',
  '',
  "[projects.'c:\\users\\leeha\\codexgui']",
  'trust_level = "trusted"',
].join('\n');

test('reads the active Codex provider without exposing its API key', () => {
  const fixture = createFixture(customConfig);
  try {
    const manager = createProviderManager({
      codexHome: fixture.root,
      providerStore: fixture.providerStore,
      reload: () => true,
    });
    const state = manager.get();
    assert.equal(state.activeId, 'custom');
    assert.deepEqual(state.providers[0], {
      id: 'custom',
      name: 'custom',
      baseUrl: 'https://sub.pikaqiu.shop',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high',
      hasApiKey: true,
    });
    assert.equal('apiKey' in state.providers[0], false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('saves and activates another provider while preserving unrelated TOML settings', () => {
  const fixture = createFixture(customConfig);
  try {
    let reloads = 0;
    const manager = createProviderManager({
      codexHome: fixture.root,
      providerStore: fixture.providerStore,
      reload: () => { reloads += 1; return true; },
    });
    manager.save({ id: 'secondary', name: 'Secondary', baseUrl: 'https://api.example.com/v1', apiKey: 'secondary-key', model: 'gpt-5', reasoningEffort: 'medium' });
    const state = manager.activate('secondary');
    const config = fs.readFileSync(path.join(fixture.root, 'config.toml'), 'utf8');
    const auth = JSON.parse(fs.readFileSync(path.join(fixture.root, 'auth.json'), 'utf8'));
    assert.equal(state.activeId, 'secondary');
    assert.equal(reloads, 1);
    assert.match(config, /model_provider = "secondary"/);
    assert.match(config, /unknown_setting = "preserve me"/);
    assert.match(config, /trust_level = "trusted"/);
    assert.equal(auth.OPENAI_API_KEY, 'secondary-key');
    assert.equal(config.includes('secondary-key'), false);
    assert.deepEqual(state.providers.map(provider => provider.id).sort(), ['custom', 'secondary']);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects malformed providers and duplicate names', () => {
  const fixture = createFixture(customConfig);
  try {
    const manager = createProviderManager({ codexHome: fixture.root, providerStore: fixture.providerStore, reload: () => true });
    assert.throws(() => manager.save({ name: '', baseUrl: 'https://example.com', apiKey: 'key', model: 'gpt-5', reasoningEffort: 'high' }), /提供商名称/);
    assert.throws(() => manager.save({ name: 'Bad', baseUrl: 'ftp://example.com', apiKey: 'key', model: 'gpt-5', reasoningEffort: 'high' }), /HTTP 或 HTTPS/);
    assert.throws(() => manager.save({ name: 'custom', baseUrl: 'https://example.com', apiKey: 'key', model: 'gpt-5', reasoningEffort: 'high' }), /已存在/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rolls back both Codex files when App Server reload fails', () => {
  const fixture = createFixture(customConfig);
  try {
    const beforeConfig = fs.readFileSync(path.join(fixture.root, 'config.toml'), 'utf8');
    const beforeAuth = fs.readFileSync(path.join(fixture.root, 'auth.json'), 'utf8');
    const manager = createProviderManager({
      codexHome: fixture.root,
      providerStore: fixture.providerStore,
      reload: () => false,
    });
    manager.save({ id: 'secondary', name: 'Secondary', baseUrl: 'https://api.example.com', apiKey: 'secondary-key', model: 'gpt-5', reasoningEffort: 'low' });
    assert.throws(() => manager.activate('secondary'), /重载配置/);
    assert.equal(fs.readFileSync(path.join(fixture.root, 'config.toml'), 'utf8'), beforeConfig);
    assert.equal(fs.readFileSync(path.join(fixture.root, 'auth.json'), 'utf8'), beforeAuth);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('blocks save, activation, and deletion while Codex is busy', () => {
  const fixture = createFixture(customConfig);
  try {
    const manager = createProviderManager({
      codexHome: fixture.root,
      providerStore: fixture.providerStore,
      reload: () => true,
      isBusy: () => true,
    });
    assert.throws(() => manager.save({ id: 'secondary', name: 'Secondary', baseUrl: 'https://api.example.com', apiKey: 'key', model: 'gpt-5', reasoningEffort: 'low' }), /执行任务/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
