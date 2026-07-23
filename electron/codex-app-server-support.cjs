function activityFromItem(item, status) {
  if (!item?.id) return null;
  if (item.type === 'commandExecution') {
    return {
      id: item.id, type: 'command', status,
      command: item.command || '', output: item.aggregatedOutput || '', exitCode: item.exitCode,
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

module.exports = { activityFromItem, resolvePermissionSettings };
