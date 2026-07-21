import { Archive } from 'lucide-react';
import { Composer } from './components/Composer';
import { Sidebar } from './components/Sidebar';
import { Timeline } from './components/Timeline';
import { useSessionController } from './use-session-controller';

export function App() {
  const controller = useSessionController();

  return (
    <div className="app">
      <Sidebar
        active={controller.active}
        collapsedGroups={controller.collapsedGroups}
        groups={controller.groups}
        runningSessions={controller.runningSessions}
        onArchiveProject={controller.archiveProject}
        onArchiveSession={controller.archiveSession}
        onCreateInFolder={controller.createInFolder}
        onCreateProject={controller.createProjectSession}
        onRefresh={controller.refreshHistory}
        onSelect={controller.setActive}
        onToggleGroup={controller.toggleGroup}
      />
      <main>
        <header>
          <div>
            <b>{controller.active?.title || '未选择对话'}</b>
            <span className="path">{controller.active?.cwd || '未选择项目文件夹'}</span>
          </div>
          <div className="header-actions">
            <button
              className="icon"
              onClick={() => controller.archiveSession()}
              title={controller.running ? '正在执行，无法归档' : '归档对话'}
              disabled={!controller.active || controller.running}
            >
              <Archive size={18} />
            </button>
          </div>
        </header>
        <Timeline active={controller.active} running={controller.running} onAnswer={controller.answerUserInput} />
        <Composer
          activeSessionId={controller.active?.id}
          session={controller.active}
          input={controller.input}
          attachments={controller.attachments}
          running={controller.running}
          waiting={controller.waiting}
          compacting={controller.compacting}
          models={controller.models}
          collaborationModes={controller.collaborationModes}
          permissionMode={controller.permissionMode}
          onInputChange={controller.setInput}
          onChooseFiles={controller.chooseFiles}
          onRemoveAttachment={controller.removeAttachment}
          onSend={controller.send}
          onCompact={controller.compact}
          onNewConversation={() => controller.active?.cwd && controller.createInFolder(controller.active.cwd)}
          onClearContext={controller.clearContext}
          onModelChange={controller.setModel}
          onReasoningEffortChange={controller.setReasoningEffort}
          onModeChange={controller.setCollaborationMode}
          onPermissionModeChange={controller.setPermissionMode}
        />
      </main>
    </div>
  );
}
