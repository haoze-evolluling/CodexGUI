const { commandFromItem, commandTypeFromItem } = require('./codex-command.cjs');

function textFromToolOutput(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map(textFromToolOutput).filter(Boolean).join('\n');
  if (output && typeof output.text === 'string') return output.text;
  if (output && Array.isArray(output.content)) return textFromToolOutput(output.content);
  if (output && output.output !== undefined) return textFromToolOutput(output.output);
  if (output && output.result !== undefined) return textFromToolOutput(output.result);
  if (output && output.structuredContent !== undefined) {
    return textFromToolOutput(output.structuredContent) || JSON.stringify(output.structuredContent, null, 2);
  }
  if (output && typeof output === 'object') return JSON.stringify(output, null, 2);
  return '';
}

function normalizedType(item) {
  return String(item?.type || '').replace(/[-_]/g, '').toLowerCase();
}

function isCommandCall(item) {
  return ['commandexecution', 'commandcall', 'customtoolcall', 'functioncall', 'toolcall', 'called', 'mcptoolcall', 'collabagenttoolcall', 'agenttoolcall'].includes(normalizedType(item));
}

function isCommandOutput(item) {
  return ['customtoolcalloutput', 'functioncalloutput', 'toolcalloutput', 'calledoutput'].includes(normalizedType(item));
}

function activityStatus(item, status) {
  const eventStatus = String(status || '').replace(/[-_]/g, '').toLowerCase();
  if (eventStatus === 'running' || eventStatus === 'started' || eventStatus === 'inprogress') return 'running';
  if (eventStatus === 'completed' || eventStatus === 'done' || eventStatus === 'failed') return eventStatus === 'failed' ? 'failed' : 'completed';
  const value = String(item?.status || status || '').replace(/[-_]/g, '').toLowerCase();
  return value === 'inprogress' || value === 'started' ? 'running' : (item?.status || status);
}

function activityFromItem(item, status, toolOutput) {
  if (!item) return null;
  const id = item.callId || item.call_id || item.id;
  if (isCommandCall(item)) {
    const output = item.aggregatedOutput ?? item.aggregated_output ?? item.output ?? item.result ?? toolOutput;
    const command = commandFromItem(item);
    return {
      id: id || `command-${Math.random()}`, type: 'command', status: activityStatus(item, status),
      command, commandType: commandTypeFromItem(item, command), output: textFromToolOutput(output),
      ...(item.exitCode !== undefined || item.exit_code !== undefined ? { exitCode: item.exitCode ?? item.exit_code } : {}),
    };
  }
  if (!id) return null;
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

module.exports = { activityFromItem, isCommandOutput, resolvePermissionSettings, textFromToolOutput };
