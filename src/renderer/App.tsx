import { Archive, Undo2 } from 'lucide-react';
import { Composer } from './components/Composer';
import { AppDialog } from './components/AppDialog';
import { Sidebar } from './components/Sidebar';
import { SettingsPage } from './components/SettingsPage';
import { Timeline } from './components/Timeline';
import { TitleBar } from './components/TitleBar';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { type MouseEvent, useEffect, useState } from 'react';
import { useSessionController } from './use-session-controller';
import type { Session } from './types';

type OpenContextMenu = { x: number; y: number; items: ContextMenuItem[] };

export function App() {
  const controller = useSessionController();
  const fontSize = controller.settings.fontSize || 'small';
  const initialTheme = document.documentElement.dataset.initialTheme === 'dark' ? 'dark' : 'light';
  const theme = controller.settings.theme || initialTheme;
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [contextMenu, setContextMenu] = useState<OpenContextMenu>();

  const openProjectMenu = (event: MouseEvent, cwd: string, sessions: Session[]) => {
    event.preventDefault();
    const projectIndex = controller.groups.findIndex(group => group.cwd === cwd);
    const lastProjectIndex = controller.groups.length - 1;
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: '上移',
          disabled: projectIndex <= 0,
          onSelect: () => controller.moveProject(cwd, 'up'),
        },
        {
          label: '下移',
          disabled: projectIndex < 0 || projectIndex === lastProjectIndex,
          onSelect: () => controller.moveProject(cwd, 'down'),
        },
        {
          label: '删除项目',
          danger: true,
          disabled: sessions.some(session => controller.runningSessions.has(session.id)),
          onSelect: () => controller.deleteProject(cwd, sessions),
        },
      ],
    });
  };

  const openCopyMenu = (event: MouseEvent, text: string) => {
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [{ label: '复制', onSelect: () => navigator.clipboard.writeText(text).catch(() => undefined) }],
    });
  };

  const openPasteMenu = (event: MouseEvent, insertText: (text: string) => void) => {
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [{
        label: '粘贴',
        onSelect: () => navigator.clipboard.readText().then(insertText).catch(() => undefined),
      }],
    });
  };

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemPrefersDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const effectiveTheme = theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;

  return (
    <div className={`app theme-${effectiveTheme} font-size-${fontSize}`}>
      <TitleBar />
      {controller.dialog && <AppDialog dialog={controller.dialog} onClose={controller.closeDialog} />}
      <div className="app-workspace">
        <Sidebar
          active={controller.active}
          collapsedGroups={controller.collapsedGroups}
          groups={controller.groups}
          runningSessions={controller.runningSessions}
          onArchiveProject={controller.archiveProject}
          onArchiveSession={controller.archiveSession}
          onCreateInFolder={controller.createInFolder}
          onCreateProject={controller.createProjectSession}
          onProjectContextMenu={openProjectMenu}
          onRefresh={controller.refreshHistory}
          onSelect={session => {
            controller.closeSettings();
            controller.setActive(session);
          }}
          onSettings={controller.openSettings}
          onToggleGroup={controller.toggleGroup}
        />
        {controller.settingsOpen ? (
          <SettingsPage
            codexPath={controller.settings.codexPath}
            fontSize={fontSize}
            theme={theme}
            historyRefreshIntervalSeconds={controller.settings.historyRefreshIntervalSeconds}
            installation={controller.installation}
            savingDisabled={controller.runningSessions.size > 0}
            onClose={controller.closeSettings}
            onFontSizeChange={controller.setFontSize}
            onHistoryRefreshIntervalSecondsChange={controller.setHistoryRefreshIntervalSeconds}
            onThemeChange={controller.setTheme}
            onSave={controller.saveCodexPath}
          />
        ) : (
          <main>
            <header>
              <div>
                <b>{controller.active?.title || '未选择对话'}</b>
                <span className="path">{controller.active?.cwd || '未选择项目文件夹'}</span>
              </div>
              <div className="header-actions">
                <button
                  className="icon"
                  onClick={controller.rollback}
                  title={controller.canRollback ? '撤销最近一轮对话' : '没有可撤销的对话'}
                  disabled={!controller.canRollback}
                >
                  <Undo2 size={18} />
                </button>
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
            <Timeline active={controller.active} running={controller.running} onAnswer={controller.answerUserInput} onPlanChoice={controller.choosePlanAction} onSelectedTextContextMenu={openCopyMenu} />
            <Composer
              activeSessionId={controller.active?.id}
              session={controller.active}
              input={controller.input}
              attachments={controller.attachments}
              running={controller.running}
              waiting={controller.waiting}
              compacting={controller.compacting}
              models={controller.models}
              preferredModel={controller.settings.model}
              skills={controller.skills}
              selectedSkill={controller.selectedSkill}
              collaborationModes={controller.collaborationModes}
              permissionMode={controller.permissionMode}
              onInputChange={controller.setInput}
              onInputContextMenu={openPasteMenu}
              onChooseFiles={controller.chooseFiles}
              onAddFiles={controller.addFiles}
              onRemoveAttachment={controller.removeAttachment}
              onSend={controller.send}
              onCompact={controller.compact}
              onRollback={controller.rollback}
              onNewConversation={() => controller.active?.cwd && controller.createInFolder(controller.active.cwd)}
              onClearContext={controller.clearContext}
              onShowStatus={controller.showStatus}
              onSkillSelect={controller.selectSkill}
              onModelChange={controller.setModel}
              onReasoningEffortChange={controller.setReasoningEffort}
              onModeChange={controller.setCollaborationMode}
              onPermissionModeChange={controller.setPermissionMode}
            />
          </main>
        )}
      </div>
      {contextMenu && <ContextMenu {...contextMenu} onClose={() => setContextMenu(undefined)} />}
    </div>
  );
}
