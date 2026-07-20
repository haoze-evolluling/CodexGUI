import { useState } from 'react';
import { Check, ChevronRight, FileCode, Minimize2, Terminal } from 'lucide-react';
import { diffLineClass } from '../session-model';
import type { Activity } from '../types';

export function ActivityItem({ activity, onAnswer }: { activity: Activity; onAnswer?(activity: import('../types').UserInputActivity, answers: Record<string, { answers: string[] }>): void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  if (activity.type === 'compaction') {
    return <div className="activity compact-activity"><Minimize2 size={15} /><span>{activity.status === 'running' ? '正在压缩上下文' : '上下文已压缩'}</span></div>;
  }
  if (activity.type === 'user_input') {
    const answered = activity.status === 'answered';
    return (
      <section className="user-input-activity">
        {activity.questions.map(question => (
          <fieldset key={question.id} disabled={answered}>
            <legend>{question.header}</legend>
            <p>{question.question}</p>
            {question.options?.map(option => (
              <label className="choice" key={option.label}>
                <input type="radio" name={`${activity.id}-${question.id}`} checked={values[question.id] === option.label} onChange={() => setValues(current => ({ ...current, [question.id]: option.label }))} />
                <span><b>{option.label}</b><small>{option.description}</small></span>
              </label>
            ))}
            {(!question.options?.length || question.isOther) && <input className="other-answer" type={question.isSecret ? 'password' : 'text'} value={values[question.id] || ''} onChange={event => setValues(current => ({ ...current, [question.id]: event.target.value }))} />}
          </fieldset>
        ))}
        {answered ? <span className="answered"><Check size={15} /> 已提交</span> : (
          <button disabled={activity.questions.some(question => !values[question.id]?.trim())} onClick={() => onAnswer?.(activity, Object.fromEntries(Object.entries(values).map(([id, answer]) => [id, { answers: [answer] }])))}>提交选择</button>
        )}
      </section>
    );
  }
  if (activity.type === 'command') {
    const result = activity.status === 'running'
      ? '执行中'
      : activity.exitCode === 0 || activity.exitCode === undefined
        ? '已完成'
        : `退出码 ${activity.exitCode}`;
    return (
      <details className={`activity command-activity ${activity.status}`}>
        <summary className="activity-heading">
          <ChevronRight className="activity-chevron" size={15} />
          <Terminal size={15} />
          <span>运行命令</span>
          <small>{result}</small>
        </summary>
        <code className="activity-summary">{activity.command}</code>
        <pre className="activity-output">{activity.output || '没有可显示的输出。'}</pre>
      </details>
    );
  }

  return (
    <details className={`activity file-activity ${activity.status}`}>
      <summary className="activity-heading">
        <ChevronRight className="activity-chevron" size={15} />
        <FileCode size={15} />
        <span>文件变更</span>
        <small>{activity.status === 'running' ? '处理中' : `${activity.files.length} 个文件`}</small>
      </summary>
      <div className="file-list">
        {activity.files.map(file => (
          <section className="file-change" key={file.path}>
            <div>
              <b>{file.kind === 'add' ? '新增' : file.kind === 'delete' ? '删除' : '修改'}</b>
              <code>{file.path}</code>
            </div>
            {file.diff ? (
              <pre className="activity-output file-diff">
                {file.diff.split(/\r?\n/).map((line, index) => (
                  <span className={diffLineClass(line)} key={index}>{line || ' '}</span>
                ))}
              </pre>
            ) : <p>没有可显示的差异。</p>}
          </section>
        ))}
      </div>
    </details>
  );
}
