import { Send, Square } from 'lucide-react';

type ComposerProps = {
  activeSessionId?: string;
  input: string;
  running: boolean;
  onInputChange(value: string): void;
  onSend(): void;
};

export function Composer({ activeSessionId, input, running, onInputChange, onSend }: ComposerProps) {
  return (
    <footer>
      <textarea
        value={input}
        onChange={event => onInputChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
        placeholder="让 Codex 处理这个项目..."
        disabled={!activeSessionId}
      />
      <div className="actions">
        <span>{running ? '思考中...' : '准备就绪'}</span>
        {running ? (
          <button className="stop" onClick={() => activeSessionId && window.codex.stop(activeSessionId)}>
            <Square size={16} /> 停止
          </button>
        ) : (
          <button onClick={onSend} disabled={!activeSessionId}>
            <Send size={16} /> 发送
          </button>
        )}
      </div>
    </footer>
  );
}
