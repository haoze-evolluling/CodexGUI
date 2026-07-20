import { timelineOf } from '../session-model';
import type { Session } from '../types';
import { ActivityItem } from './ActivityItem';

const roleLabel = {
  user: '你',
  assistant: 'Codex',
  error: '错误',
  system: '系统提示',
} as const;

export function Timeline({ active, running }: { active?: Session; running: boolean }) {
  return (
    <section className="messages">
      {active && timelineOf(active).map(item => item.type === 'message' ? (
        <div className={`message ${item.role}`} key={item.id}>
          <label>{roleLabel[item.role]}</label>
          <pre>{item.text}</pre>
        </div>
      ) : <ActivityItem activity={item} key={item.id} />)}
      {!active && <div className="empty-conversation">请从左侧选择或新建一个对话。</div>}
      {running && (
        <div className="message thinking">
          <label>Codex</label>
          <div className="thinking-status"><span>思考中</span><i /><i /><i /></div>
        </div>
      )}
    </section>
  );
}
