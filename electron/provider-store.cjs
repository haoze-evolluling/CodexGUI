const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : '';
  const model = typeof value.model === 'string' ? value.model.trim() : '';
  const reasoningEffort = typeof value.reasoningEffort === 'string' ? value.reasoningEffort.trim() : '';
  if (!id || !name || !baseUrl || !model || !reasoningEffort) return null;
  return {
    id,
    name,
    baseUrl,
    model,
    reasoningEffort,
    encryptedApiKey: typeof value.encryptedApiKey === 'string' ? value.encryptedApiKey : '',
  };
}

function createProviderStore(filePath, encryption) {
  const secureStorage = encryption || {
    encryptString(value) {
      return Buffer.from(value, 'utf8');
    },
    decryptString(value) {
      return Buffer.from(value).toString('utf8');
    },
  };

  function records() {
    const value = readJson(filePath);
    return Object.values(value.providers || {})
      .map(normalizeRecord)
      .filter(Boolean);
  }

  function saveRecords(items) {
    writeJson(filePath, {
      providers: Object.fromEntries(items.map(item => [item.id, item])),
    });
  }

  return {
    list() {
      return records();
    },
    get(id) {
      return records().find(item => item.id === id) || null;
    },
    getApiKey(id) {
      const record = records().find(item => item.id === id);
      if (!record?.encryptedApiKey) return '';
      try {
        return secureStorage.decryptString(Buffer.from(record.encryptedApiKey, 'base64'));
      } catch {
        return '';
      }
    },
    save(record, apiKey) {
      const items = records().filter(item => item.id !== record.id);
      const current = this.get(record.id);
      const nextKey = typeof apiKey === 'string' && apiKey.trim()
        ? apiKey.trim()
        : this.getApiKey(record.id);
      const next = normalizeRecord({
        ...record,
        encryptedApiKey: nextKey
          ? secureStorage.encryptString(nextKey).toString('base64')
          : current?.encryptedApiKey || '',
      });
      if (!next) throw new Error('提供商资料无效。');
      items.push(next);
      saveRecords(items);
      return next;
    },
    remove(id) {
      saveRecords(records().filter(item => item.id !== id));
    },
  };
}

module.exports = { createProviderStore };
