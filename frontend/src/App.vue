<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Archive, CheckCircle2, ChevronRight, CircleAlert, CloudCog, Moon, Plus, RefreshCw, Search, Settings2, SlidersHorizontal, Sun, Trash2, Undo2 } from 'lucide-vue-next'
import { api } from './services'
import { useWorkbenchStore } from './stores/workbench'
import type { ProviderInput, Session } from './types'

const store = useWorkbenchStore()
const route = useRoute()
const router = useRouter()
const query = ref('')
const notice = ref('')
const saving = ref(false)
const editing = ref<string | null>(null)
const form = ref<ProviderInput>({ name: '', baseUrl: '', apiKey: '', model: '', reasoningEffort: 'medium' })
const page = computed(() => route.path.slice(1) || 'archive')
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return !needle ? store.sessions : store.sessions.filter(item => [item.title, item.cwd, item.model].join(' ').toLowerCase().includes(needle))
})
const title = computed(() => ({ archive: '归档会话', providers: '模型提供商', settings: '应用设置' }[page.value] || 'Codex GUI'))

watch(() => store.settings.theme, value => document.documentElement.dataset.theme = value, { immediate: true })
watch(() => store.settings.fontSize, value => document.documentElement.dataset.fontSize = value, { immediate: true })
onMounted(() => { void store.bootstrap() })
function navigate(value: string) { void router.push(`/${value}`); notice.value = '' }
function date(value: number) { return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(value) : '未知时间' }
function resetForm() { editing.value = null; form.value = { name: '', baseUrl: '', apiKey: '', model: '', reasoningEffort: 'medium' } }
function editProvider(id: string) { const item = store.providers.providers.find(provider => provider.id === id); if (!item) return; editing.value = id; form.value = { id: item.id, name: item.name, baseUrl: item.baseUrl, apiKey: '', model: item.model, reasoningEffort: item.reasoningEffort }; window.scrollTo({ top: 0, behavior: 'smooth' }) }
async function saveProvider() { saving.value = true; notice.value = ''; try { await store.useProvider(api.saveProvider(form.value)); notice.value = '提供商已保存。'; resetForm() } catch (error) { notice.value = error instanceof Error ? error.message : String(error) } finally { saving.value = false } }
async function activate(id: string) { saving.value = true; notice.value = ''; try { await store.useProvider(api.activateProvider(id)); notice.value = '已切换提供商。' } catch (error) { notice.value = error instanceof Error ? error.message : String(error) } finally { saving.value = false } }
async function removeProvider(id: string) { if (!window.confirm('确定删除此提供商吗？')) return; try { await store.useProvider(api.deleteProvider(id)); notice.value = '提供商已删除。'; if (editing.value === id) resetForm() } catch (error) { notice.value = error instanceof Error ? error.message : String(error) } }
async function runSession(action: () => Promise<{ ok: boolean; error?: string }>) { notice.value = ''; try { const result = await action(); if (!result.ok) throw new Error(result.error || '操作失败。'); await store.refreshSessions() } catch (error) { notice.value = error instanceof Error ? error.message : String(error) } }
async function clearSessions() { if (!window.confirm(`确定删除 ${store.sessions.length} 条归档会话吗？此操作无法撤销。`)) return; await runSession(() => api.clear()) }
async function saveAppearance(patch: Partial<typeof store.settings>) { try { await store.saveSettings({ ...store.settings, ...patch }) } catch (error) { notice.value = error instanceof Error ? error.message : String(error) } }
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark"><CloudCog :size="20" /></div><div><strong>Codex GUI</strong><span>管理工作台</span></div></div>
      <nav aria-label="主导航">
        <button :class="{ active: page === 'archive' }" @click="navigate('archive')"><Archive :size="18" /><span>归档会话</span><b>{{ store.sessions.length }}</b></button>
        <button :class="{ active: page === 'providers' }" @click="navigate('providers')"><SlidersHorizontal :size="18" /><span>模型提供商</span></button>
        <button :class="{ active: page === 'settings' }" @click="navigate('settings')"><Settings2 :size="18" /><span>应用设置</span></button>
      </nav>
      <div class="sidebar-status" :class="store.installation.status"><span></span><div><b>{{ store.installation.status === 'ready' ? 'Codex 已就绪' : 'Codex 不可用' }}</b><small>{{ store.installation.status === 'ready' ? store.installation.source : store.installation.error }}</small></div></div>
    </aside>
    <main class="workspace">
      <header><div><h1>{{ title }}</h1><p v-if="page === 'archive'">查看并维护由 Codex 管理的已归档线程。</p><p v-else-if="page === 'providers'">维护模型连接配置，并安全切换当前使用的提供商。</p><p v-else>调整应用外观并配置本机 Codex 可执行文件。</p></div><button class="icon-button" title="刷新" :disabled="store.loading || store.refreshing" @click="store.refreshAll"><RefreshCw :size="18" :class="{ spin: store.refreshing }" /></button></header>
      <p v-if="store.error || notice" class="notice" :class="{ error: store.error }"><CircleAlert :size="16" />{{ store.error || notice }}</p>
      <section v-if="store.loading" class="empty"><RefreshCw class="spin" :size="24" /><p>正在加载管理数据...</p></section>

      <template v-else-if="page === 'archive'">
        <div class="toolbar"><label class="search"><Search :size="17" /><input v-model="query" placeholder="搜索标题、路径或模型" /></label><button class="danger" :disabled="!store.sessions.length" @click="clearSessions"><Trash2 :size="16" />清空归档</button></div>
        <section v-if="filtered.length" class="session-list"><article v-for="session in filtered" :key="session.id" class="session-row"><div class="session-main"><strong>{{ session.title }}</strong><p>{{ session.cwd || '未记录工作目录' }}</p><small>{{ session.model || '未记录模型' }}<i></i>{{ date(session.updated) }}</small></div><div class="row-actions"><button title="恢复会话" @click="runSession(() => api.restore(session.threadId))"><Undo2 :size="17" /></button><button title="删除会话" class="danger-icon" @click="runSession(() => api.remove(session.threadId))"><Trash2 :size="17" /></button></div></article></section>
        <section v-else class="empty"><Archive :size="30" /><h2>没有匹配的归档会话</h2><p>归档线程会在此处显示。</p></section>
      </template>

      <template v-else-if="page === 'providers'">
        <div class="providers-layout"><section class="provider-list"><div class="section-heading"><div><h2>已保存的提供商</h2><p>当前配置由 Windows 凭据管理器保护。</p></div><button class="icon-button" title="新增提供商" @click="resetForm"><Plus :size="18" /></button></div><article v-for="provider in store.providers.providers" :key="provider.id" class="provider-row" :class="{ selected: editing === provider.id }"><button class="provider-info" @click="editProvider(provider.id)"><span class="provider-avatar">{{ provider.name.slice(0, 1).toUpperCase() }}</span><span><strong>{{ provider.name }}</strong><small>{{ provider.model }} · {{ provider.reasoningEffort }}</small></span><CheckCircle2 v-if="provider.id === store.providers.activeId || provider.model === store.providers.model" class="active-check" :size="18" /></button><div class="provider-actions"><button v-if="provider.id !== store.providers.activeId" @click="activate(provider.id)">启用</button><button title="删除提供商" class="danger-icon" @click="removeProvider(provider.id)"><Trash2 :size="16" /></button></div></article><div v-if="!store.providers.providers.length" class="empty small"><CloudCog :size="26" /><p>添加第一个模型提供商。</p></div></section>
          <form class="provider-form" @submit.prevent="saveProvider"><div class="section-heading"><div><h2>{{ editing ? '编辑提供商' : '新建提供商' }}</h2><p>密钥留空时保留已保存的值。</p></div></div><label>名称<input v-model.trim="form.name" required placeholder="例如 OpenAI" /></label><label>请求地址<input v-model.trim="form.baseUrl" required type="url" placeholder="https://api.example.com/v1" /></label><div class="two-fields"><label>默认模型<input v-model.trim="form.model" required placeholder="gpt-5" /></label><label>推理强度<select v-model="form.reasoningEffort"><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="xhigh">极高</option></select></label></div><label>API Key<input v-model="form.apiKey" type="password" :required="!editing" autocomplete="new-password" placeholder="仅保存至 Windows 凭据管理器" /></label><div class="form-actions"><button v-if="editing" type="button" class="secondary" @click="resetForm">取消</button><button type="submit" :disabled="saving"><CheckCircle2 :size="17" />{{ saving ? '保存中' : '保存提供商' }}</button></div></form></div>
      </template>

      <template v-else>
        <section class="settings-grid"><article><div class="card-title"><Sun :size="18" /><div><h2>界面主题</h2><p>选择适合当前环境的显示模式。</p></div></div><div class="segmented"><button :class="{ active: store.settings.theme === 'light' }" @click="saveAppearance({ theme: 'light' })"><Sun :size="16" />明亮</button><button :class="{ active: store.settings.theme === 'dark' }" @click="saveAppearance({ theme: 'dark' })"><Moon :size="16" />深色</button></div></article><article><div class="card-title"><Settings2 :size="18" /><div><h2>字体大小</h2><p>控制工作台的文本密度。</p></div></div><div class="segmented"><button v-for="size in ['small', 'medium', 'large']" :key="size" :class="{ active: store.settings.fontSize === size }" @click="saveAppearance({ fontSize: size as any })">{{ { small: '小', medium: '中', large: '大' }[size] }}</button></div></article><article class="codex-path"><div class="card-title"><CloudCog :size="18" /><div><h2>Codex 可执行文件</h2><p>{{ store.installation.status === 'ready' ? `当前来源：${store.installation.source}` : store.installation.error }}</p></div></div><input :value="store.settings.codexPath" placeholder="留空则从 PATH 自动查找" @change="saveAppearance({ codexPath: ($event.target as HTMLInputElement).value })" /><small v-if="store.installation.path">{{ store.installation.path }}</small></article></section>
      </template>
    </main>
  </div>
</template>
