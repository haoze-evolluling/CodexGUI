function inputFromOptions(options) {
  const prompt = typeof options.prompt === 'string' ? options.prompt : '';
  if (prompt.length > 200_000) throw new Error('输入内容过长，无法发送。');
  const attachments = (options.attachments || []).flatMap(attachment => {
    if (!attachment || typeof attachment.path !== 'string') return [];
    const path = attachment.path.trim();
    if (!path) return [];
    if (/[\x00-\x1F]/.test(path)) throw new Error('附件路径包含不支持的控制字符。');
    return [{ ...attachment, path }];
  });
  if (attachments.length > 20) throw new Error('一次最多可添加 20 个附件。');
  const input = [];
  if (options.skill?.name && options.skill?.path) {
    input.push({ type: 'skill', name: options.skill.name, path: options.skill.path });
  }

  // Mentions carry the file to app-server. Keep the selected paths in the text
  // as well, so the agent is explicitly asked to inspect them in this turn.
  const attachmentContext = attachments.length
    ? `\n\nThe following local files are part of this request.\n\nRead and use them as context before producing any response.\n\nFiles:\n${attachments.map(attachment => `- ${attachment.path.replace(/[\r\n]/g, '\\n')}`).join('\n')}`
    : '';
  if (prompt || attachmentContext) input.push({ type: 'text', text: `${prompt}${attachmentContext}`.trim() });
  for (const attachment of attachments) {
    if (attachment.kind === 'image') input.push({ type: 'localImage', path: attachment.path });
    else input.push({ type: 'mention', name: attachment.name || attachment.path, path: attachment.path });
  }
  return input;
}

module.exports = { inputFromOptions };
