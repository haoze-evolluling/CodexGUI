import { ChevronRight, FileCode, Terminal } from 'lucide-react';
import { diffLineClass } from '../session-model';
import type { Activity } from '../types';

export function ActivityItem({ activity }: { activity: Activity }) {
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
