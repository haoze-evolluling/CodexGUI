import { Archive, Kanban, LayoutGrid, X } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { FeatureId } from '../types';

type FeatureCenterPageProps = {
  onClose(): void;
  onFeatureContextMenu(event: MouseEvent, featureId: FeatureId): void;
  onOpenArchive(): void;
  onOpenTrello(): void;
};

export function FeatureCenterPage(props: FeatureCenterPageProps) {
  return (
    <main className="settings-page feature-center-page">
      <header className="settings-page-header">
        <div>
          <b>功能中心</b>
          <span className="path">访问 Codex GUI 的常用功能</span>
        </div>
        <div className="header-actions">
          <button className="icon" onClick={props.onClose} title="返回对话" aria-label="返回对话">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="settings-page-body">
        <section className="settings-section feature-center-section">
          <div className="settings-section-title">
            <LayoutGrid size={18} />
            <div>
              <b>功能</b>
              <p className="settings-hint">选择要使用的功能。</p>
            </div>
          </div>

          <div className="feature-center-list">
            <button className="feature-center-item" onClick={props.onOpenArchive} onContextMenu={event => props.onFeatureContextMenu(event, 'archive')}>
              <Archive size={20} />
              <span className="feature-center-item-copy">
                <b>查看归档会话</b>
                <span>查看、恢复或移除已归档的对话。</span>
              </span>
            </button>
            <button className="feature-center-item" onClick={props.onOpenTrello} onContextMenu={event => props.onFeatureContextMenu(event, 'trello')}>
              <Kanban size={20} />
              <span className="feature-center-item-copy">
                <b>Trello 看板</b>
                <span>用列表、卡片和标签整理你的工作流。</span>
              </span>
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
