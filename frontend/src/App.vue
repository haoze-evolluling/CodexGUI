<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  Activity,
  Archive,
  Check,
  CheckCircle2,
  CircleAlert,
  Cloud,
  Command,
  ExternalLink,
  KeyRound,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { api } from "./services";
import { useWorkbenchStore } from "./stores/workbench";
import type { ProviderInput } from "./types";

const store = useWorkbenchStore();
const route = useRoute();
const router = useRouter();
const query = ref("");
const notice = ref("");
const saving = ref(false);
const editing = ref<string | null>(null);
const addingProvider = ref(false);
const form = ref<ProviderInput>({
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  reasoningEffort: "medium",
});
const page = computed(() => route.path.slice(1) || "archive");
const filtered = computed(() => {
  const n = query.value.trim().toLowerCase();
  return !n
    ? store.sessions
    : store.sessions.filter((s) =>
        [s.title, s.cwd, s.model].join(" ").toLowerCase().includes(n),
      );
});
const pageMeta = computed(
  () =>
    ({
      archive: ["归档会话", "回顾、恢复并整理最近的 Codex 工作线程。"],
      providers: ["模型提供商", "集中管理连接，快速切换当前运行环境。"],
      settings: ["工作台设置", "让 Codex Manager 更贴合你的工作习惯。"],
    })[page.value] || ["工作台", ""],
);
watch(
  () => store.settings.theme,
  (v) => (document.documentElement.dataset.theme = v),
  { immediate: true },
);
watch(
  () => store.settings.fontSize,
  (v) => (document.documentElement.dataset.fontSize = v),
  { immediate: true },
);
onMounted(() => void store.bootstrap());
function nav(v: string) {
  void router.push("/" + v);
  notice.value = "";
}
function date(v: number) {
  return v
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(v)
    : "时间未知";
}
function resetForm() {
  editing.value = null;
  form.value = {
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
    reasoningEffort: "medium",
  };
}
function addProvider() {
  resetForm();
  addingProvider.value = true;
}
function editProvider(id: string) {
  const p = store.providers.providers.find((x) => x.id === id);
  if (!p) return;
  editing.value = id;
  form.value = {
    id,
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: "",
    model: p.model,
    reasoningEffort: p.reasoningEffort,
  };
}
async function saveProvider() {
  saving.value = true;
  try {
    await store.useProvider(api.saveProvider(form.value));
    notice.value = "提供商配置已保存";
    resetForm();
    addingProvider.value = false;
  } catch (e) {
    notice.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}
async function activate(id: string) {
  saving.value = true;
  try {
    await store.useProvider(api.activateProvider(id));
    notice.value = "已切换当前提供商";
  } catch (e) {
    notice.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}
async function removeProvider(id: string) {
  if (!confirm("确定删除此提供商吗？")) return;
  try {
    await store.useProvider(api.deleteProvider(id));
    notice.value = "提供商已删除";
    if (editing.value === id) resetForm();
    if (!store.providers.providers.length) addingProvider.value = false;
  } catch (e) {
    notice.value = e instanceof Error ? e.message : String(e);
  }
}
async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
  try {
    const r = await action();
    if (!r.ok) throw new Error(r.error || "操作失败");
    await store.refreshSessions();
  } catch (e) {
    notice.value = e instanceof Error ? e.message : String(e);
  }
}
async function clearSessions() {
  if (confirm(`确定删除 ${store.sessions.length} 条归档会话吗？`))
    await run(api.clear);
}
async function saveAppearance(patch: Partial<typeof store.settings>) {
  try {
    await store.saveSettings({ ...store.settings, ...patch });
  } catch (e) {
    notice.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-symbol"><Command :size="19" /></div>
        <div><strong>Codex Manager</strong><span>本地工作台</span></div>
      </div>
      <div class="nav-label">工作区</div>
      <nav>
        <button :class="{ active: page === 'archive' }" @click="nav('archive')">
          <Archive :size="17" /><span>归档会话</span
          ><b>{{ store.sessions.length }}</b></button
        ><button
          :class="{ active: page === 'providers' }"
          @click="nav('providers')"
        >
          <SlidersHorizontal :size="17" /><span>模型提供商</span>
        </button>
      </nav>
      <div class="nav-label secondary-label">系统</div>
      <nav>
        <button
          :class="{ active: page === 'settings' }"
          @click="nav('settings')"
        >
          <Settings2 :size="17" /><span>工作台设置</span>
        </button>
      </nav>
      <div class="sidebar-footer">
        <div class="connection">
          <span :class="['status-dot', store.installation.status]"></span>
          <div>
            <strong>{{
              store.installation.status === "ready"
                ? "Codex 在线"
                : "Codex 未连接"
            }}</strong
            ><small>{{
              store.installation.status === "ready"
                ? store.installation.source
                : "检查可执行文件路径"
            }}</small>
          </div>
        </div>
        <small class="version">Codex Manager · 2.0</small>
      </div>
    </aside>
    <main class="main-area">
      <header class="topbar">
        <div class="breadcrumbs">
          <span>Codex Manager</span><i>/</i><strong>{{ pageMeta[0] }}</strong>
        </div>
        <div class="top-actions">
          <span class="live-pill"><Activity :size="14" /> 本地服务正常</span
          ><button
            class="refresh"
            title="刷新数据"
            :disabled="store.loading || store.refreshing"
            @click="store.refreshAll"
          >
            <RefreshCw :size="16" :class="{ spin: store.refreshing }" />
          </button>
        </div>
      </header>
      <div class="content">
        <section class="page-heading">
          <div>
            <p class="eyebrow">
              {{
                page === "archive"
                  ? "SESSION ARCHIVE"
                  : page === "providers"
                    ? "MODEL ROUTING"
                    : "PREFERENCES"
              }}
            </p>
            <h1>{{ pageMeta[0] }}</h1>
            <p>{{ pageMeta[1] }}</p>
          </div>
          <div v-if="page === 'archive'" class="stat">
            <span>归档总数</span><strong>{{ store.sessions.length }}</strong>
          </div>
          <div v-else-if="page === 'providers'" class="stat">
            <span>已配置连接</span
            ><strong>{{ store.providers.providers.length }}</strong>
          </div>
        </section>
        <p
          v-if="store.error || notice"
          class="notice"
          :class="{ error: store.error }"
        >
          <CircleAlert :size="16" />{{ store.error || notice
          }}<button v-if="notice" @click="notice = ''"><X :size="14" /></button>
        </p>
        <section v-if="store.loading" class="empty-state">
          <RefreshCw class="spin" :size="24" />
          <p>正在准备工作台…</p>
        </section>

        <template v-else-if="page === 'archive'"
          ><div class="toolbar">
            <label class="search"
              ><Search :size="17" /><input
                v-model="query"
                placeholder="搜索标题、路径或模型" /></label
            ><button
              class="danger-button"
              :disabled="!store.sessions.length"
              @click="clearSessions"
            >
              <Trash2 :size="16" /> 清空归档
            </button>
          </div>
          <section v-if="filtered.length" class="surface session-table">
            <div class="table-head">
              <span>线程</span><span>最后活动</span><span>操作</span>
            </div>
            <article v-for="s in filtered" :key="s.id" class="session-row">
              <div class="session-icon"><Archive :size="16" /></div>
              <div class="session-info">
                <strong>{{ s.title }}</strong
                ><span>{{ s.cwd || "未记录工作目录" }}</span
                ><small>{{ s.model || "未记录模型" }}</small>
              </div>
              <time>{{ date(s.updated) }}</time>
              <div class="row-actions">
                <button
                  title="恢复会话"
                  @click="run(() => api.restore(s.threadId))"
                >
                  <Undo2 :size="16" /></button
                ><button
                  class="delete"
                  title="删除会话"
                  @click="run(() => api.remove(s.threadId))"
                >
                  <Trash2 :size="16" />
                </button>
              </div>
            </article>
          </section>
          <section v-else class="empty-state surface">
            <Archive :size="28" />
            <h2>没有找到归档线程</h2>
            <p>新的归档会话会显示在这里。</p>
          </section></template
        >

        <template v-else-if="page === 'providers'"
          ><section
            v-if="!store.providers.providers.length && !addingProvider"
            class="surface provider-empty-state"
          >
            <div class="empty-state-icon"><Cloud :size="28" /></div>
            <h2>暂无模型提供商配置</h2>
            <p>添加一个提供商后，即可为 Codex 配置模型、请求地址和访问凭据。</p>
            <button class="primary-button" type="button" @click="addProvider">
              <Plus :size="16" /> 添加提供商
            </button>
          </section>
          <div v-else class="providers-layout">
            <section class="surface provider-panel">
              <div class="panel-header">
                <div>
                  <span class="eyebrow">CONNECTIONS</span>
                  <h2>已保存的提供商</h2>
                </div>
                <button
                  class="primary-icon"
                  title="新增提供商"
                  @click="addProvider"
                >
                  <Plus :size="18" />
                </button>
              </div>
              <article
                v-for="p in store.providers.providers"
                :key="p.id"
                class="provider-row"
                :class="{ selected: editing === p.id }"
              >
                <button class="provider-main" @click="editProvider(p.id)">
                  <span class="provider-badge">{{
                    p.name.slice(0, 1).toUpperCase()
                  }}</span
                  ><span
                    ><strong>{{ p.name }}</strong
                    ><small
                      >{{ p.model }} · {{ p.reasoningEffort }}</small
                    ></span
                  ><CheckCircle2
                    v-if="p.id === store.providers.activeId"
                    class="active-check"
                    :size="17"
                  />
                </button>
                <div class="provider-actions">
                  <button
                    v-if="p.id !== store.providers.activeId"
                    class="activate"
                    @click="activate(p.id)"
                  >
                    启用</button
                  ><button
                    class="delete"
                    title="删除提供商"
                    @click="removeProvider(p.id)"
                  >
                    <Trash2 :size="15" />
                  </button>
                </div>
              </article>
            </section>
            <form class="surface provider-form" @submit.prevent="saveProvider">
              <div class="panel-header">
                <div>
                  <span class="eyebrow">{{
                    editing ? "EDIT CONNECTION" : "NEW CONNECTION"
                  }}</span>
                  <h2>{{ editing ? "编辑提供商" : "添加提供商" }}</h2>
                </div>
                <KeyRound :size="19" class="panel-icon" />
              </div>
              <label
                >显示名称<input
                  v-model.trim="form.name"
                  required
                  placeholder="例如 OpenAI" /></label
              ><label
                >请求地址<input
                  v-model.trim="form.baseUrl"
                  required
                  type="url"
                  placeholder="https://api.example.com/v1"
              /></label>
              <div class="two-fields">
                <label
                  >默认模型<input
                    v-model.trim="form.model"
                    required
                    placeholder="gpt-5" /></label
                ><label
                  >推理强度<select v-model="form.reasoningEffort">
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                    <option value="xhigh">极高</option>
                  </select></label
                >
              </div>
              <label
                >API Key<input
                  v-model="form.apiKey"
                  type="password"
                  :required="!editing"
                  placeholder="保存在系统凭据管理器"
              /></label>
              <div class="form-actions">
                <button
                  v-if="editing"
                  type="button"
                  class="secondary"
                  @click="resetForm"
                >
                  取消</button
                ><button
                  class="primary-button"
                  type="submit"
                  :disabled="saving"
                >
                  <Check :size="16" /> {{ saving ? "保存中…" : "保存连接" }}
                </button>
              </div>
            </form>
          </div></template
        >

        <template v-else
          ><section class="settings-grid">
            <article class="surface setting-card">
              <div class="setting-title">
                <span class="setting-icon"><Sun :size="17" /></span>
                <div>
                  <h2>界面主题</h2>
                  <p>选择适合当前环境的显示模式。</p>
                </div>
              </div>
              <div class="segmented">
                <button
                  :class="{ active: store.settings.theme === 'light' }"
                  @click="saveAppearance({ theme: 'light' })"
                >
                  <Sun :size="15" />明亮</button
                ><button
                  :class="{ active: store.settings.theme === 'dark' }"
                  @click="saveAppearance({ theme: 'dark' })"
                >
                  <Moon :size="15" />深色
                </button>
              </div>
            </article>
            <article class="surface setting-card">
              <div class="setting-title">
                <span class="setting-icon"><Settings2 :size="17" /></span>
                <div>
                  <h2>字体大小</h2>
                  <p>控制工作台的文本密度。</p>
                </div>
              </div>
              <div class="segmented compact-segment">
                <button
                  v-for="size in ['small', 'medium', 'large']"
                  :key="size"
                  :class="{ active: store.settings.fontSize === size }"
                  @click="saveAppearance({ fontSize: size as any })"
                >
                  {{ { small: "小", medium: "中", large: "大" }[size] }}
                </button>
              </div>
            </article>
            <article class="surface setting-card path-card">
              <div class="setting-title">
                <span class="setting-icon"><ExternalLink :size="17" /></span>
                <div>
                  <h2>Codex 可执行文件</h2>
                  <p>
                    {{
                      store.installation.status === "ready"
                        ? `当前来源：${store.installation.source}`
                        : store.installation.error
                    }}
                  </p>
                </div>
              </div>
              <input
                :value="store.settings.codexPath"
                placeholder="留空则从 PATH 自动查找"
                @change="
                  saveAppearance({
                    codexPath: ($event.target as HTMLInputElement).value,
                  })
                "
              /><small v-if="store.installation.path">{{
                store.installation.path
              }}</small>
            </article>
          </section></template
        >
      </div>
    </main>
  </div>
</template>
