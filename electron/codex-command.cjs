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
  if (!match) return '';
  return decodeStringLiteral(script.slice(match.index + match[0].length), match[1]) || '';
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

function commandTypeFromCommand(command) {
  const value = String(command || '').trim();
  const normalized = value.toLowerCase();
  const token = firstCommandToken(value).replace(/\.exe$/, '');
  let executor = '其他';
  let operation = '工具调用';

  if (/^(?:powershell|pwsh)$/.test(token) || /^(?:get|set|remove|add|clear|new|copy|move|rename|write|out|invoke|test|select|resolve)-[a-z]/i.test(value)) {
    executor = 'PowerShell';
  } else if (/^cmd$/.test(token) || /\.(?:cmd|bat)(?:\s|$)/i.test(normalized)) {
    executor = 'CMD';
  } else if (token === 'git') {
    executor = 'Git';
  }

  if (executor === 'Git') {
    const subcommand = normalized.replace(/^git\s+/, '').split(/\s+/)[0];
    if (subcommand === 'status') operation = '查询状态';
    else if (subcommand === 'diff') operation = '查看差异';
    else if (subcommand === 'log') operation = '查看历史';
    else if (subcommand === 'show') operation = '查看内容';
    else if (['add', 'commit', 'checkout', 'switch', 'merge', 'rebase', 'reset', 'restore', 'rm', 'mv'].includes(subcommand)) operation = '修改版本库';
    else operation = '版本控制';
  } else if (/(?:^|[\s;|"'])\s*(?:get-content|gc|cat|type|more|head|tail)(?:\s|$)/i.test(value)) {
    operation = '读取';
  } else if (/(?:^|[\s;|"'])\s*(?:rg|ripgrep|grep|findstr|select-string)(?:\s|$)/i.test(value)) {
    operation = '搜索';
  } else if (/(?:^|[\s;|"'])\s*(?:set-content|sc|out-file|tee-object|tee)(?:\s|$)/i.test(value) || /(?:>|>>)/.test(value)) {
    operation = '写入';
  } else if (/(?:^|[\s;|"'])\s*(?:remove-item|ri|del|erase|rm|rmdir)(?:\s|$)/i.test(value)) {
    operation = '删除';
  }

  return executor + ' · ' + operation;
}

module.exports = { commandFromItem, commandTypeFromCommand };
