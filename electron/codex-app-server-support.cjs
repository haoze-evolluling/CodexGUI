function textFromToolOutput(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map(part => part?.text || '').filter(Boolean).join('\n');
  if (output && typeof output.text === 'string') return output.text;
  return '';
}

function normalizedType(item) {
  return String(item?.type || '').replace(/[-_]/g, '').toLowerCase();
}

function textFromValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromValue).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (value.command !== undefined) return textFromValue(value.command);
    if (typeof value.cmd === 'string') return value.cmd;
    if (typeof value.input === 'string') return value.input;
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return '';
}

function parsedValue(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' ? value : null;
}

function commandFromItem(item) {
  const args = parsedValue(item.arguments ?? item.args);
  const direct = item.command ?? item.cmd;
  if (direct !== undefined) return textFromValue(direct);
  if (args?.command !== undefined) return textFromValue(args.command);
  if (args?.cmd !== undefined) return textFromValue(args.cmd);
  if (item.input !== undefined) {
    const input = parsedValue(item.input);
    if (input?.command !== undefined) return textFromValue(input.command);
    if (input?.cmd !== undefined) return textFromValue(input.cmd);
    return textFromValue(item.input);
  }
  if (item.arguments !== undefined) return textFromValue(item.arguments);
  return item.name || item.toolName || '工具调用';
}

function isCommandCall(item) {
  return ['commandexecution', 'commandcall', 'customtoolcall', 'functioncall', 'toolcall', 'called'].includes(normalizedType(item));
}

function isCommandOutput(item) {
  return ['customtoolcalloutput', 'functioncalloutput', 'toolcalloutput', 'calledoutput'].includes(normalizedType(item));
}

function activityFromItem(item, status, toolOutput) {
  if (!item) return null;
  const id = item.callId || item.call_id || item.id;
  if (!id) return null;
  if (isCommandCall(item)) {
    const output = item.aggregatedOutput ?? item.aggregated_output ?? item.output ?? toolOutput;
    return {
      id, type: 'command', status: item.status || status,
      command: commandFromItem(item), output: textFromToolOutput(output),
      ...(item.exitCode !== undefined || item.exit_code !== undefined ? { exitCode: item.exitCode ?? item.exit_code } : {}),
    };
  }
  if (item.type === 'fileChange') {
    return {
      id: item.id, type: 'file_change', status,
      files: (item.changes || []).map(change => ({ path: change.path, kind: change.kind || 'update' })),
    };
  }
  if (item.type === 'contextCompaction') return { id: item.id, type: 'compaction', status };
  return null;
}

function sandboxPolicyFromConfig(config) {
  if (config.sandbox_mode === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (config.sandbox_mode === 'read-only') return { type: 'readOnly' };
  const workspace = config.sandbox_workspace_write || {};
  return {
    type: 'workspaceWrite',
    writableRoots: workspace.writable_roots || [],
    networkAccess: workspace.network_access === true,
    excludeSlashTmp: workspace.exclude_slash_tmp === true,
    excludeTmpdirEnvVar: workspace.exclude_tmpdir_env_var === true,
  };
}

async function resolvePermissionSettings({ ensureReady, request }, options) {
  if (options.permissionMode === 'yolo') {
    return {
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      sandboxPolicy: { type: 'dangerFullAccess' },
    };
  }
  await ensureReady();
  try {
    const result = await request('config/read', { cwd: options.cwd, includeLayers: false });
    const config = result.config || {};
    return {
      approvalPolicy: config.approval_policy || 'on-request',
      sandbox: config.sandbox_mode || 'workspace-write',
      sandboxPolicy: sandboxPolicyFromConfig(config),
    };
  } catch {
    return {
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      sandboxPolicy: { type: 'workspaceWrite' },
    };
  }
}

module.exports = { activityFromItem, isCommandOutput, resolvePermissionSettings };
