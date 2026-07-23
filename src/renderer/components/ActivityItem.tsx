import { useState } from 'react';
import { Check, ChevronRight, Code2, ExternalLink, FileCode, Minimize2, Terminal } from 'lucide-react';
import { diffLineClass } from '../session-model';
import type { Activity, PlanDecisionActivity } from '../types';

export function ActivityItem({
  activity,
  cwd,
  onAnswer,
  onOpenPath,
  onOpenInVsCode,
  onPlanChoice,
}: {
  activity: Activity;
  cwd?: string;
  onAnswer?(activity: import('../types').UserInputActivity, answers: Record<string, { answers: string[] }>): void;
  onOpenPath?(path: string): void;
  onOpenInVsCode?(path: string): void;
  onPlanChoice?(activity: PlanDecisionActivity, choice: NonNullable<PlanDecisionActivity['choice']>): void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  if (activity.type === 'plan_decision') {
    if (activity.status === 'answered') return null;
    return (
      <section className="plan-decision" aria-label="执行计划选项">
        <b>执行这个计划？</b>
        <button onClick={() => onPlanChoice?.(activity, 'implement')}>
          <span><strong>1. 是，执行该计划</strong><small>切换到默认模式并开始编码。</small></span>
        </button>
        <button onClick={() => onPlanChoice?.(activity, 'fresh')}>
          <span><strong>2. 是，清除上下文后执行</strong><small>创建新上下文，携带当前计划并开始编码。</small></span>
        </button>
        <button onClick={() => onPlanChoice?.(activity, 'stay')}>
          <span><strong>3. 否，停留在计划模式</strong><small>关闭此选择，继续完善计划。</small></span>
        </button>
      </section>
    );
  }
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
            <div className="question-options">
            {question.options?.map((option, index) => (
              <label className={`choice ${values[question.id] === option.label ? 'selected' : ''}`} key={option.label}>
                <input type="radio" name={`${activity.id}-${question.id}`} checked={values[question.id] === option.label} onChange={() => setValues(current => ({ ...current, [question.id]: option.label }))} />
                <span><b>{index + 1}. {option.label}</b><small>{option.description}</small></span>
              </label>
            ))}
            </div>
            {(!question.options?.length || question.isOther) && (
              <input
                className="other-answer"
                type={question.isSecret ? 'password' : 'text'}
                value={values[question.id] || ''}
                placeholder={question.isSecret
                  ? '请输入敏感信息，内容不会显示'
                  : question.options?.length
                    ? '也可以在这里输入其他答案'
                    : '请在这里输入你的回答'}
                onChange={event => setValues(current => ({ ...current, [question.id]: event.target.value }))}
              />
            )}
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
            <div className="file-change-header">
              <div>
                <b>{file.kind === 'add' ? '新增' : file.kind === 'delete' ? '删除' : '修改'}</b>
                <code title={file.path}>{file.path}</code>
              </div>
              <div className="file-change-actions">
                <button type="button" onClick={() => onOpenPath?.(file.path)} title="用默认应用打开" disabled={!cwd && !/^[A-Za-z]:[\\/]|^\\|^\//.test(file.path)}>
                  <ExternalLink size={14} />
                  打开
                </button>
                <button type="button" onClick={() => onOpenInVsCode?.(file.path)} title="在 VS Code 中打开" disabled={!cwd && !/^[A-Za-z]:[\\/]|^\\|^\//.test(file.path)}>
                  <Code2 size={14} />
                  VS Code
                </button>
              </div>
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
