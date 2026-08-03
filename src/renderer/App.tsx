import { Archive, ArrowDown, ArrowUp, ClipboardPaste, Copy, FolderOpen, Kanban, Pencil, Pin, PinOff, Terminal, Trash2, Undo2 } from 'lucide-react';
import { Composer } from './components/Composer';
import { AppDialog } from './components/AppDialog';
import { Sidebar } from './components/Sidebar';
import { SettingsPage } from './components/SettingsPage';
import { ArchivePage } from './components/ArchivePage';
import { FeatureCenterPage } from './components/FeatureCenterPage';
import { Timeline } from './components/Timeline';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { useSessionController } from './use-session-controller';
import type { FeatureId, Session } from './types';

type OpenContextMenu = { x: number; y: number; items: ContextMenuItem[] };

export function App() {
  const controller = useSessionController();
  const fontSize = controller.settings.fontSize || 'small';
  const initialTheme = document.documentElement.dataset.initialTheme === 'dark' ? 'dark' : 'light';
  const theme = controller.settings.theme || initialTheme;
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [contextMenu, setContextMenu] = useState<OpenContextMenu>();
  const [contentTransitioning, setContentTransitioning] = useState(false);
  const contentTransitioningRef = useRef(false);

  const transitionContent = async (action: () => void | Promise<void>) => {
    if (contentTransitioningRef.current) return;
    contentTransitioningRef.current = true;
    setContentTransitioning(true);
    try {
      await new Promise<void>(resolve => window.setTimeout(resolve, 50));
      await action();
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
    } finally {
      contentTransitioningRef.current = false;
      setContentTransitioning(false);
    }
  };

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
          icon: <ArrowUp size={16} />,
          disabled: projectIndex <= 0,
          onSelect: () => controller.moveProject(cwd, 'up'),
        },
        {
          label: '下移',
          icon: <ArrowDown size={16} />,
          disabled: projectIndex < 0 || projectIndex === lastProjectIndex,
          onSelect: () => controller.moveProject(cwd, 'down'),
        },
        {
          label: '归档项目',
          icon: <Archive size={16} />,
          disabled: sessions.some(session => controller.runningSessions.has(session.id)),
          onSelect: () => controller.archiveProject(cwd, sessions),
        },
        {
          label: '删除项目',
          icon: <Trash2 size={16} />,
          danger: true,
          disabled: sessions.some(session => controller.runningSessions.has(session.id)),
          onSelect: () => controller.deleteProject(cwd, sessions),
        },
      ],
    });
  };

  const openSessionMenu = (event: MouseEvent, session: Session, startRenaming: () => void) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: '重命名', icon: <Pencil size={16} />, disabled: !session.threadId, onSelect: startRenaming },
        {
          label: '归档对话',
          icon: <Archive size={16} />,
          disabled: controller.runningSessions.has(session.id),
          onSelect: () => controller.archiveSession(session),
        },
      ],
    });
  };

  const openCopyMenu = (event: MouseEvent, text: string) => {
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [{ label: '复制', icon: <Copy size={16} />, onSelect: () => navigator.clipboard.writeText(text).catch(() => undefined) }],
    });
  };

  const openInputMenu = (event: MouseEvent, selectedText: string, insertText: (text: string) => void) => {
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        ...(selectedText ? [{ label: '复制', icon: <Copy size={16} />, onSelect: () => navigator.clipboard.writeText(selectedText).catch(() => undefined) }] : []),
        { label: '粘贴', icon: <ClipboardPaste size={16} />, onSelect: () => navigator.clipboard.readText().then(insertText).catch(() => undefined) },
      ],
    });
  };

  const openFeatureMenu = (event: MouseEvent, featureId: FeatureId) => {
    event.preventDefault();
    const pinned = controller.pinnedFeatureIds.includes(featureId);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [{
        label: pinned ? '移出标题栏' : '添加到标题栏',
        icon: pinned ? <PinOff size={16} /> : <Pin size={16} />,
        onSelect: () => controller.togglePinnedFeature(featureId),
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
      {controller.dialog && <AppDialog dialog={controller.dialog} onClose={controller.closeDialog} />}
      <div className="app-workspace">
        {!controller.settingsOpen && (
          <Sidebar
            active={controller.active}
            collapsedGroups={controller.collapsedGroups}
            groups={controller.groups}
            historyError={controller.historyError}
            refreshing={controller.refreshingHistory}
            runningSessions={controller.runningSessions}
            onCreateInFolder={cwd => void transitionContent(() => controller.createInFolder(cwd))}
            onCreateProject={controller.createProjectSession}
            onProjectContextMenu={openProjectMenu}
            onRefresh={controller.refreshHistory}
            onRenameSession={controller.renameSession}
            onSessionContextMenu={openSessionMenu}
            onSelect={session => {
              void transitionContent(() => {
                controller.closeSettings();
                controller.closeArchive();
                controller.closeFeatureCenter();
                controller.setActive(session);
              });
            }}
            onSettings={() => void transitionContent(controller.openSettings)}
            onOpenFeatureCenter={() => void transitionContent(controller.openFeatureCenter)}
            onToggleGroup={controller.toggleGroup}
          />
        )}
        <div className={`content-page ${contentTransitioning ? 'content-transitioning' : ''}`} aria-busy={contentTransitioning}>
          {controller.settingsOpen ? (
            <SettingsPage
              codexPath={controller.settings.codexPath}
              fontSize={fontSize}
              theme={theme}
              installation={controller.installation}
              providerState={controller.providerState}
              savingDisabled={controller.runningSessions.size > 0}
              onClose={() => void transitionContent(controller.closeSettings)}
              onFontSizeChange={controller.setFontSize}
              onThemeChange={controller.setTheme}
              onSave={controller.saveCodexPath}
              onProviderSave={controller.saveProvider}
              onProviderActivate={controller.activateProvider}
              onProviderDelete={controller.deleteProvider}
            />
          ) : controller.featureCenterOpen ? (
            <FeatureCenterPage
              onClose={() => void transitionContent(controller.closeFeatureCenter)}
              onFeatureContextMenu={openFeatureMenu}
              onOpenArchive={() => void transitionContent(controller.openArchive)}
              onOpenTrello={() => void window.codex.openTrello()}
            />
          ) : controller.archiveOpen ? (
            <ArchivePage
              sessions={controller.archivedSessions}
              onClose={() => void transitionContent(controller.closeArchiveToFeatureCenter)}
              onClear={controller.clearArchivedSessions}
              onRefresh={() => void controller.refreshArchivedSessions()}
              onRemove={controller.removeArchivedSession}
              onRestore={session => void transitionContent(() => controller.restoreArchivedSession(session))}
            />
          ) : (
            <main>
            <header>
              <div className="conversation-header-content">
                <b className="conversation-title">{controller.active?.title || '未选择对话'}</b>
                <span className="path">{controller.active?.cwd || '未选择项目文件夹'}</span>
              </div>
              <div className="header-actions">
                {controller.pinnedFeatureIds.map(featureId => featureId === 'archive' ? (
                  <button key={featureId} className="icon" onClick={() => void transitionContent(controller.openArchive)} title="查看归档会话" aria-label="查看归档会话">
                    <Archive size={18} />
                  </button>
                ) : (
                  <button key={featureId} className="icon" onClick={() => void window.codex.openTrello()} title="Trello 看板" aria-label="Trello 看板">
                    <Kanban size={18} />
                  </button>
                ))}
                <button className="icon" onClick={controller.openProjectDirectory} title="在文件资源管理器中打开项目目录" aria-label="在文件资源管理器中打开项目目录" disabled={!controller.active?.cwd}>
                  <FolderOpen size={18} />
                </button>
                <button className="icon" onClick={controller.openTerminal} title="在 Windows Terminal 中打开项目目录" aria-label="在 Windows Terminal 中打开项目目录" disabled={!controller.active?.cwd}>
                  <Terminal size={18} />
                </button>
                <button
                  className="icon"
                  onClick={controller.rollback}
                  title={controller.canRollback ? '撤销最近一轮对话' : '没有可撤销的对话'}
                  disabled={!controller.canRollback}
                >
                  <Undo2 size={18} />
                </button>
              </div>
            </header>
            <Timeline
              active={controller.active}
              refreshing={controller.refreshingMessages}
              running={controller.running}
              onAnswer={controller.answerUserInput}
              onOpenPath={controller.openPath}
              onOpenInVsCode={controller.openInVsCode}
              onPlanChoice={controller.choosePlanAction}
              onLoadDiff={controller.loadDiff}
              onSelectedTextContextMenu={openCopyMenu}
            />
            <Composer
              activeSessionId={controller.active?.id}
              session={controller.active}
              input={controller.input}
              attachments={controller.attachments}
              running={controller.running}
              stopping={controller.stopping}
              waiting={controller.waiting}
              compacting={controller.compacting}
              rollingBack={controller.rollingBack}
              models={controller.models}
              preferredModel={controller.providerState?.model || controller.settings.model}
              preferredReasoningEffort={controller.settings.reasoningEffort || controller.providerState?.reasoningEffort}
              skills={controller.skills}
              selectedSkill={controller.selectedSkill}
              collaborationModes={controller.collaborationModes}
              permissionMode={controller.permissionMode}
              onInputChange={controller.setInput}
              onInputContextMenu={openInputMenu}
              onChooseFiles={controller.chooseFiles}
              onAddFiles={controller.addFiles}
              listMentionFiles={controller.listMentionFiles}
              onRemoveAttachment={controller.removeAttachment}
              onSend={controller.send}
              onStop={controller.stop}
              onCompact={controller.compact}
              onRollback={controller.rollback}
              onNewConversation={() => {
                const cwd = controller.active?.cwd;
                if (cwd) void transitionContent(() => controller.createInFolder(cwd));
              }}
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
      </div>
      {contextMenu && <ContextMenu {...contextMenu} onClose={() => setContextMenu(undefined)} />}
    </div>
  );
}

