function textFromValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromValue).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (value.command !== undefined) return textFromValue(value.command);
    if (value.cmd !== undefined) return textFromValue(value.cmd);
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

function normalizedItemType(item) {
  return String(item?.type || '').replace(/[-_]/g, '').toLowerCase();
}

function toolNameFromItem(item) {
  return [item?.name, item?.toolName, item?.tool_name, item?.tool, item?.functionName, item?.function_name]
    .find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

function textFromItemValue(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  try { return JSON.stringify(value); } catch { return ''; }
}

function uniqueMcpTools(tools) {
  const seen = new Set();
  return tools.filter(tool => {
    const key = `${tool.server}\u0000${tool.tool}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mcpToolsFromText(source) {
  const text = String(source || '');
  const tools = [];
  const namespaced = /(?:^|[\s("'`])(?:tools\.)?mcp__([A-Za-z0-9_.-]+?)__([A-Za-z0-9_.-]+)/gi;
  for (const match of text.matchAll(namespaced)) tools.push({ server: match[1], tool: match[2] });
  const dotted = /(?:^|[\s("'`])(?:tools\.)?mcp[.:/]([A-Za-z0-9_-]+)[.:/]([A-Za-z0-9_.-]+)/gi;
  for (const match of text.matchAll(dotted)) tools.push({ server: match[1], tool: match[2] });
  return uniqueMcpTools(tools);
}

function mcpToolsFromItem(item) {
  const name = toolNameFromItem(item);
  const server = [item?.server, item?.serverName, item?.server_name, item?.mcpServer, item?.mcp_server]
    .find(value => typeof value === 'string' && value.trim())?.trim() || '';
  const source = [name, item?.type, server && `mcp__${server}__${name}`, item?.input, item?.arguments, item?.args, item?.command]
    .map(textFromItemValue).filter(Boolean).join('\n');
  const tools = mcpToolsFromText(source);
  if (server && name && !tools.length) tools.push({ server, tool: name });
  if (!tools.length && normalizedItemType(item).includes('mcp')) tools.push({ server: server || '工具', tool: name || '调用' });
  return uniqueMcpTools(tools);
}

function mcpTypeFromTools(tools) {
  const labels = tools.slice(0, 2).map(tool => `${tool.server} / ${tool.tool}`);
  if (tools.length > 2) labels.push(`还有 ${tools.length - 2} 个工具`);
  return `MCP · ${labels.join(', ')}`;
}

function decodeStringLiteral(source, quote) {
  let result = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === quote) return result;
    if (character !== '\\' || index + 1 >= source.length) {
      result += character;
      continue;
    }
    const escaped = source[++index];
    if (escaped === 'n') result += '\n';
    else if (escaped === 'r') result += '\r';
    else if (escaped === 't') result += '\t';
    else if (escaped === 'b') result += '\b';
    else if (escaped === 'f') result += '\f';
    else if (escaped === 'v') result += '\v';
    else if (escaped === '0') result += '\0';
    else if (escaped === 'u' && /^[0-9a-f]{4}$/i.test(source.slice(index + 1, index + 5))) {
      result += String.fromCharCode(parseInt(source.slice(index + 1, index + 5), 16));
      index += 4;
    } else if (escaped === 'x' && /^[0-9a-f]{2}$/i.test(source.slice(index + 1, index + 3))) {
      result += String.fromCharCode(parseInt(source.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      result += escaped;
    }
  }
  return null;
}

function commandFromScript(script) {
  if (typeof script !== 'string') return '';
  const match = script.match(/\btools\.shell_command\s*\(\s*\{[\s\S]*?\bcommand\s*:\s*(['"`])/i);
  if (match) return decodeStringLiteral(script.slice(match.index + match[0].length), match[1]) || '';
  if (/\btools\.apply_patch\s*\(/i.test(script)) return 'apply_patch';
  if (/\btools\.view_image\s*\(/i.test(script)) return 'view_image';
  const mcpTool = mcpToolsFromText(script)[0];
  if (mcpTool) return `mcp__${mcpTool.server}__${mcpTool.tool}`;
  return '';
}

function commandFromValue(value) {
  if (typeof value === 'string') return commandFromScript(value) || value.trim();
  return textFromValue(value).trim();
}

function commandFromItem(item) {
  const args = parsedValue(item?.arguments ?? item?.args);
  const direct = item?.command ?? item?.cmd;
  if (direct !== undefined) return commandFromValue(direct);
  if (args?.command !== undefined) return commandFromValue(args.command);
  if (args?.cmd !== undefined) return commandFromValue(args.cmd);
  if (item?.input !== undefined) {
    const input = parsedValue(item.input);
    if (input?.command !== undefined) return commandFromValue(input.command);
    if (input?.cmd !== undefined) return commandFromValue(input.cmd);
    if (typeof item.input === 'string' && item.name === 'exec' && !commandFromScript(item.input)) return item.name;
    return commandFromValue(item.input);
  }
  if (item?.arguments !== undefined) return commandFromValue(item.arguments);
  return item?.name || item?.toolName || item?.tool_name || '工具调用';
}

function firstCommandToken(command) {
  return String(command || '')
    .trim()
    .replace(/^(?:\$env:[A-Za-z_][\w]*\s*=\s*[^;]+;\s*)+/i, '')
    .replace(/^(?:sudo\s+|env\s+|command\s+|\.?[\\/]?)(?:\s*)/i, '')
    .match(/^(?:"([^"]+)"|'([^']+)'|([^\s|;&<>]+))/)?.slice(1).find(Boolean)?.toLowerCase() || '';
}

function commandOperation(value, normalized, token, executor) {
  if (executor === 'Git') {
    const subcommand = normalized.replace(/^git\s+/, '').split(/\s+/)[0];
    if (subcommand === 'status') return '查询状态';
    if (subcommand === 'diff') return '查看差异';
    if (subcommand === 'log') return '查看历史';
    if (subcommand === 'show') return '查看内容';
    if (['add', 'commit', 'checkout', 'switch', 'merge', 'rebase', 'reset', 'restore', 'rm', 'mv'].includes(subcommand)) return '修改版本库';
    return '版本控制';
  }

  if (/(?:^|\s)(?:test|tests|pytest|jest|vitest|mocha|ava|unittest)\b/i.test(value)
    || /(?:^|\s)(?:npm|pnpm|yarn|bun|cargo|go|dotnet|mvn|gradle)\s+(?:run\s+)?test\b/i.test(value)) return '测试';
  if (/(?:^|\s)(?:build|compile|bundle|tsc|webpack|rollup|esbuild|make)\b/i.test(value)
    || /(?:^|\s)(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/i.test(value)
    || /(?:^|\s)(?:cargo|go|dotnet|mvn|gradle)\s+build\b/i.test(value)
    || (token === 'vite' && /\bvite\s+build\b/i.test(value))) return '构建';

  if (/^(?:npm|pnpm|yarn|bun)\s+(?:install|i|add)\b/i.test(normalized)
    || /^(?:pip|pip3|uv|poetry)\s+(?:install|add)\b/i.test(normalized)) return '安装依赖';
  if (/^(?:npm|pnpm|yarn|bun)\s+(?:uninstall|remove|rm)\b/i.test(normalized)
    || /^(?:pip|pip3|uv|poetry)\s+(?:uninstall|remove)\b/i.test(normalized)) return '移除依赖';
  if (/^(?:npm|pnpm|yarn|bun)\s+(?:update|upgrade)\b/i.test(normalized)
    || /^(?:pip|pip3|uv|poetry)\s+update\b/i.test(normalized)) return '更新依赖';
  if (/^(?:npm|pnpm|yarn|bun)\s+(?:run|exec)\b/i.test(normalized)) return '运行脚本';

  if (/(?:^|[\s;|"'])\s*(?:rg|ripgrep|grep|egrep|fgrep|findstr|select-string|fd|find|locate|where)\b/i.test(value)) return '搜索';
  if (/(?:^|[\s;|"'])\s*(?:get-content|gc|cat|type|more|head|tail|ls|dir|get-childitem|get-location|pwd|stat|tree)\b/i.test(value)) return '读取';
  if (/(?:^|[\s;|"'])\s*(?:set-content|add-content|sc|out-file|tee-object|tee|new-item|mkdir|touch|copy-item|copy|cp|move-item|move|mv|rename-item|write)\b/i.test(value) || /(?:>|>>)/.test(value)) return '写入';
  if (/(?:^|[\s;|"'])\s*(?:remove-item|ri|del|erase|rm|rmdir|trash)\b/i.test(value)) return '删除';

  if (executor === 'Network') {
    if (/^(?:ssh|telnet)\b/i.test(token)) return '远程连接';
    if (/^(?:scp|rsync)\b/i.test(token)) return '文件传输';
    return '网络请求';
  }
  if (executor === 'Container') {
    if (/\b(?:build|buildx)\b/i.test(normalized)) return '构建镜像';
    if (/\b(?:run|exec)\b/i.test(normalized)) return '运行容器';
    return '容器管理';
  }
  if (['PowerShell', 'CMD', 'Shell'].includes(executor)) return '执行命令';
  if (['Node.js', 'Python', 'Ruby', 'PHP', 'Java', 'Go', 'Rust', 'TypeScript', 'Kubernetes'].includes(executor)) return '运行脚本';
  if (['npm', 'pnpm', 'Yarn', 'Bun', 'Pip', 'Poetry'].includes(executor)) return '执行工具';
  return '工具调用';
}

function commandTypeFromCommand(command) {
  const value = String(command || '').trim();
  const normalized = value.toLowerCase();
  const mcpTools = mcpToolsFromText(value);
  if (mcpTools.length) return mcpTypeFromTools(mcpTools);
  const token = firstCommandToken(value).replace(/\.exe$/, '');
  let executor = '其他';

  if (token === 'apply_patch' || token === 'view_image' || token === 'exec') {
    executor = 'Codex';
  } else if (/^(?:powershell|pwsh)$/.test(token) || /^(?:get|set|remove|add|clear|new|copy|move|rename|write|out|invoke|test|select|resolve)-[a-z]/i.test(value)) {
    executor = 'PowerShell';
  } else if (/^cmd$/.test(token) || /\.(?:cmd|bat)(?:\s|$)/i.test(normalized)) {
    executor = 'CMD';
  } else if (/^(?:bash|sh|zsh|fish|ksh|dash|ash|busybox)$/.test(token)) {
    executor = 'Shell';
  } else if (token === 'git') {
    executor = 'Git';
  } else if (/^(?:node|nodejs)$/.test(token)) {
    executor = 'Node.js';
  } else if (/^(?:python|python3|pytest)$/.test(token)) {
    executor = 'Python';
  } else if (token === 'ruby') {
    executor = 'Ruby';
  } else if (/^(?:php|composer)$/.test(token)) {
    executor = 'PHP';
  } else if (/^(?:java|javac|mvn|gradle)$/.test(token)) {
    executor = 'Java';
  } else if (token === 'go') {
    executor = 'Go';
  } else if (/^(?:rustc|cargo)$/.test(token)) {
    executor = 'Rust';
  } else if (/^(?:tsc|tsx)$/.test(token)) {
    executor = 'TypeScript';
  } else if (/^(?:npm|pnpm)$/.test(token)) {
    executor = token;
  } else if (token === 'yarn') {
    executor = 'Yarn';
  } else if (token === 'bun') {
    executor = 'Bun';
  } else if (/^(?:pip|pip3|uv|poetry)$/.test(token)) {
    executor = token === 'poetry' ? 'Poetry' : 'Pip';
  } else if (/^(?:docker|podman)$/.test(token)) {
    executor = 'Container';
  } else if (/^(?:kubectl|helm)$/.test(token)) {
    executor = 'Kubernetes';
  } else if (/^(?:curl|wget|http|httpie|ssh|scp|rsync|telnet)$/.test(token)) {
    executor = 'Network';
  }

  let operation = commandOperation(value, normalized, token, executor);
  if (executor === 'Codex') operation = token === 'apply_patch' ? '修改文件' : token === 'view_image' ? '查看图像' : '工具编排';
  return executor + ' · ' + operation;
}

function displayToolName(name) {
  return String(name || '').replace(/^tools\./i, '').replace(/__/g, ' / ') || '工具调用';
}

function commandTypeFromItem(item, command = commandFromItem(item)) {
  const mcpTools = mcpToolsFromItem(item);
  if (mcpTools.length) return mcpTypeFromTools(mcpTools);

  const fromCommand = commandTypeFromCommand(command);
  const name = toolNameFromItem(item);
  const normalizedName = name.toLowerCase();
  const type = normalizedItemType(item);
  if (/^(?:browser|web|web_search|web\.run)$/.test(normalizedName)) return 'Web · 浏览或搜索';
  if (/^(?:file_search|file_read|read_file|list_directory)$/.test(normalizedName)) return '文件 · 查询或读取';
  if (/^(?:computer|computer_use|screenshot)$/.test(normalizedName)) return '界面 · 操作';
  if (!fromCommand.startsWith('其他 · ')) return fromCommand;
  if (/^(?:shell_command|shell|bash|sh|zsh|fish)$/.test(normalizedName)) return fromCommand.replace(/^其他 · /, 'Shell · ') === fromCommand ? 'Shell · 执行命令' : fromCommand.replace(/^其他 · /, 'Shell · ');
  if (/^(?:powershell|pwsh)$/.test(normalizedName)) return fromCommand.replace(/^其他 · /, 'PowerShell · ') === fromCommand ? 'PowerShell · 执行命令' : fromCommand.replace(/^其他 · /, 'PowerShell · ');
  if (normalizedName === 'cmd') return fromCommand.replace(/^其他 · /, 'CMD · ') === fromCommand ? 'CMD · 执行命令' : fromCommand.replace(/^其他 · /, 'CMD · ');
  if (type === 'commandexecution' || type === 'commandcall') return fromCommand.replace(/^其他 · /, 'Shell · ') === fromCommand ? 'Shell · 执行命令' : fromCommand.replace(/^其他 · /, 'Shell · ');
  if (type === 'functioncall') return '函数 · ' + displayToolName(name);
  if (type === 'customtoolcall') return '自定义工具 · ' + displayToolName(name);
  if (type === 'toolcall' || type === 'called') return '工具 · ' + displayToolName(name);
  return fromCommand;
}

module.exports = { commandFromItem, commandTypeFromCommand, commandTypeFromItem };
