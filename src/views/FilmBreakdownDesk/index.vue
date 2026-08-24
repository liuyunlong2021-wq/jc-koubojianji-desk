<template>
  <main class="desk-shell">
    <header class="project-bar">
      <div class="product-switch" aria-label="产品模式"><button @click="router.push('/')">口播剪辑</button><button class="active">影片拉片</button></div>
      <v-divider vertical class="mx-1" />
      <v-btn color="primary" variant="flat" size="small" prepend-icon="mdi-folder-plus-outline" @click="chooseProject">选择项目</v-btn>
      <v-select v-model="projectRoot" class="project-select" :items="projectHistory" item-title="name" item-value="rootPath" density="compact" variant="outlined" hide-details placeholder="未选择项目" aria-label="选择项目" @update:model-value="switchProject" />
      <v-btn icon="mdi-folder-open-outline" variant="text" size="small" title="在访达中显示" :disabled="!projectRoot" @click="showProject" />
      <v-divider vertical class="mx-2" />
      <div class="workflow-title"><v-icon size="18">mdi-movie-open-edit-outline</v-icon><strong>影片拉片工作台</strong><span>{{ shots.length }} 镜</span></div>
      <v-spacer />
      <v-btn icon="mdi-cog-outline" variant="text" size="small" title="设置" aria-label="设置" @click="openSettings" />
    </header>

    <section class="breakdown-workspace" :class="{ 'source-lock': downloadingSource }">
      <section class="source-preview" aria-label="原片预览">
        <video v-if="sourceFileName" ref="sourceVideo" class="video-stage" controls :src="sourceVideoUrl" @timeupdate="stopShotPreview" />
        <div v-else class="video-stage empty-stage">
          <v-menu><template #activator="{ props }"><v-btn v-bind="props" color="primary" variant="flat" prepend-icon="mdi-import" append-icon="mdi-chevron-down" :disabled="downloadingSource">导入影片</v-btn></template><v-list density="compact"><v-list-item prepend-icon="mdi-folder-video-outline" title="本地影片" @click="chooseSource" /><v-list-item prepend-icon="mdi-link-variant" title="视频链接" @click="openSourceDialog" /></v-list></v-menu>
        </div>
        <div class="video-meta"><span>{{ sourceFileName || '尚未导入影片' }}</span><v-menu v-if="sourceFileName"><template #activator="{ props }"><v-btn v-bind="props" size="x-small" variant="text" color="primary" append-icon="mdi-chevron-down" :disabled="downloadingSource">更换影片</v-btn></template><v-list density="compact"><v-list-item prepend-icon="mdi-folder-video-outline" title="本地影片" @click="chooseSource" /><v-list-item prepend-icon="mdi-link-variant" title="视频链接" @click="openSourceDialog" /></v-list></v-menu></div>
        <section class="asset-sidebar">
          <header><div><h2>本片资产</h2><p>{{ imageAssets.length ? `已识别 ${imageAssets.length} 项` : '资产分析后显示' }}</p></div><v-icon size="19">mdi-image-multiple-outline</v-icon></header>
          <div v-if="!imageAssets.length" class="asset-empty">尚未识别角色、场景和关键道具</div>
          <section v-for="group in assetGroups" v-else :key="group.category" class="asset-group">
            <label class="asset-group-title"><input type="checkbox" :checked="group.assets.length > 0 && group.assets.every((asset) => asset.selected)" @change="toggleAssetGroup(group.category)" />{{ group.title }}<span>{{ group.assets.length }}</span></label>
            <label v-for="asset in group.assets" :key="asset.assetId" class="asset-item">
              <input type="checkbox" :checked="asset.selected" @change="toggleAsset(asset.assetId)" />
              <img :src="assetFrameUrl(asset)" alt="" />
              <span><strong>{{ asset.name }}</strong><small>出现 {{ asset.occurrences.length }} 帧</small></span>
            </label>
          </section>
        </section>
      </section>

      <section class="shot-panel">
        <header class="panel-heading"><div><h1>{{ resultView === 'shots' ? '镜头画面' : resultView === 'assets' ? '资产提示词' : '项目总览' }}</h1><p>{{ resultView === 'shots' ? '点击镜头预览对应原片区间' : resultView === 'assets' ? '查看并修改已生成的资产结果' : '查看并修改完整提示词的全局设置' }}</p></div><v-btn-toggle v-model="resultView" density="compact" mandatory divided><v-btn value="shots" size="small">镜头画面</v-btn><v-btn value="assets" size="small" :disabled="!imageAssets.length">资产库</v-btn><v-btn value="overview" size="small" :disabled="!videoOverview">项目总览</v-btn></v-btn-toggle></header>
        <div v-if="resultView === 'shots' && !shots.length" class="empty-list"><v-icon size="46">mdi-filmstrip-box-multiple</v-icon><strong>等待镜头检测</strong></div>
        <article v-for="shot in resultView === 'shots' ? shots : []" :key="shot.shotId" class="shot-row" :class="{ selected: selectedShotId === shot.shotId }" @click="selectShot(shot)">
          <div class="shot-index"><strong>{{ shot.shotId }}</strong><span>{{ formatTime(shot.startMs) }} - {{ formatTime(shot.endMs) }}</span><small>{{ ((shot.endMs - shot.startMs) / 1000).toFixed(1) }} 秒</small></div>
          <img v-if="shot.frameFileNames?.start || shot.frameFileName" class="shot-frame" :src="shotFrameUrl(shot)" alt="" />
          <div v-else class="shot-frame frame-placeholder"><v-icon>mdi-image-outline</v-icon></div>
          <div class="shot-copy" @click.stop>
            <template v-for="entry in shotVideoEntries(shot)" :key="entry.template">
              <label>{{ entry.title }}</label>
              <textarea :value="entry.value" :aria-label="`${shot.shotId} ${entry.title}`" placeholder="等待视频反推" @change="saveVideoResult(shot, entry.template, $event)" />
            </template>
            <template v-for="entry in shotImageEntries(shot)" :key="entry.position">
              <label>{{ entry.title }}图片提示词</label>
              <textarea v-model="shot.imagePrompts![entry.position]" :aria-label="`${shot.shotId} ${entry.title}图片提示词`" @change="saveFramePrompt(shot, entry.position)" />
            </template>
            <template v-if="!shotImageEntries(shot).length"><label>图片提示词</label><textarea v-model="shot.imagePrompt" :aria-label="`${shot.shotId} 图片提示词`" placeholder="默认将反推首帧" @change="savePrompt(shot)" /></template>
            <p v-if="shot.error" class="shot-error">{{ shot.error }}</p>
          </div>
          <v-chip class="shot-status" size="x-small" :color="statusColor(shot.analysisStatus)" variant="tonal">{{ statusText(shot.analysisStatus) }}</v-chip>
        </article>
        <div v-if="resultView === 'assets' && !imageAssets.length" class="empty-list"><v-icon size="46">mdi-image-search-outline</v-icon><strong>请先进行资产分析</strong></div>
        <article v-for="asset in resultView === 'assets' ? imageAssets : []" :key="asset.assetId" class="asset-result-row">
          <img :src="assetFrameUrl(asset)" alt="" />
          <div class="asset-result-copy"><div><strong>{{ asset.name }}</strong><span>{{ assetCategoryName(asset.category) }} · 出现 {{ asset.occurrences.length }} 帧</span></div><p>{{ asset.description }}</p><textarea v-model="asset.prompt" :placeholder="asset.selected ? '等待生成资产提示词' : '请先在左栏选中'" @change="saveAssetPrompt(asset)" /><small v-if="asset.error" class="shot-error">{{ asset.error }}</small></div>
          <v-chip size="x-small" :color="statusColor(asset.status)" variant="tonal">{{ statusText(asset.status) }}</v-chip>
        </article>
        <section v-if="resultView === 'overview' && videoOverview" class="overview-form">
          <label>叙事主线<textarea v-model="videoOverview.narrative" @change="saveOverview" /></label>
          <label>灯光哲学<textarea v-model="videoOverview.lightingPhilosophy" @change="saveOverview" /></label>
          <label>色彩分级<textarea v-model="videoOverview.colorGrading" @change="saveOverview" /></label>
          <label>时间状态语法<textarea v-model="videoOverview.timeRules" @change="saveOverview" /></label>
          <label>场所<textarea v-model="videoOverview.setting" @change="saveOverview" /></label>
          <label>环境音<textarea v-model="videoOverview.ambientSound" @change="saveOverview" /></label>
          <label>人群规则<textarea v-model="videoOverview.crowd" @change="saveOverview" /></label>
          <label>技术约束<textarea :value="videoOverview.technicalConstraints.join('\n')" @change="saveOverviewConstraints" /></label>
          <section class="role-list"><h2>镜头功能</h2><label v-for="shot in shots" :key="shot.shotId"><span>{{ shot.shotId }}</span><input v-model="videoOverview.shotRoles[shot.shotId]" placeholder="可留空" @change="saveOverview" /></label></section>
        </section>
      </section>

      <aside class="actions-panel">
        <section class="action-section">
          <h2>镜头检测</h2>
          <v-select v-model="threshold" :items="thresholds" item-title="title" item-value="value" label="切镜灵敏度" density="compact" variant="outlined" hide-details />
          <v-btn block color="primary" variant="flat" prepend-icon="mdi-content-cut" class="mt-3" :loading="detecting" :disabled="!sourceFileName || detecting || preparing || analyzing || imageWorking || overviewWorking" @click="detectShots">自动切镜</v-btn>
        </section>
        <section class="action-section">
          <h2>播放头校正</h2>
          <p>当前位置 {{ formatTime(playheadMs) }}</p>
          <v-btn block color="primary" variant="tonal" prepend-icon="mdi-content-cut" :disabled="!selectedShot" @click="editShot('split')">在当前位置拆分</v-btn>
          <v-btn block variant="text" prepend-icon="mdi-call-merge" :disabled="!selectedShot" @click="editShot('merge-next')">与下一镜合并</v-btn>
          <v-btn block variant="text" prepend-icon="mdi-ray-start-vertex" :disabled="!selectedShot" @click="editShot('set-start')">设为所选镜头开始</v-btn>
          <v-btn block variant="text" prepend-icon="mdi-ray-end" :disabled="!selectedShot" @click="editShot('set-end')">设为所选镜头结束</v-btn>
          <v-btn block variant="text" color="error" prepend-icon="mdi-delete-outline" :disabled="!selectedShot" @click="editShot('delete')">删除所选镜头</v-btn>
          <v-btn block color="primary" variant="flat" prepend-icon="mdi-check-circle-outline" class="mt-2" :loading="preparing" :disabled="!shots.length || boundariesConfirmed || detecting || preparing || analyzing || imageWorking || overviewWorking" @click="confirmShots">确认镜头切分</v-btn>
        </section>
        <section class="action-section">
          <h2>图片分析</h2>
          <p>资产分析会检查每镜的首帧、中间帧和尾帧，并合并重复资产。</p>
          <v-btn block color="primary" variant="flat" prepend-icon="mdi-image-search-outline" :disabled="!boundariesConfirmed || imageWorking || analyzing || overviewWorking" @click="identifyAssets">资产分析</v-btn>
          <label class="mt-4">画面反推范围</label>
          <v-btn-toggle v-model="selectedFramePositions" class="frame-toggle" density="compact" multiple mandatory divided><v-btn value="start">首帧</v-btn><v-btn value="middle">中间帧</v-btn><v-btn value="end">尾帧</v-btn></v-btn-toggle>
          <v-btn block color="primary" variant="flat" prepend-icon="mdi-image-edit-outline" class="mt-3" :loading="imageWorking" :disabled="!boundariesConfirmed || !selectedFramePositions.length || imageWorking || analyzing || overviewWorking" @click="generateFramePrompts">反推全片所选画面</v-btn>
          <p v-if="imageWorking" class="action-progress">{{ progressMessage || '正在准备画面反推…' }}</p>
          <v-btn block color="primary" variant="flat" prepend-icon="mdi-auto-fix" class="mt-2" :disabled="!selectedAssetCount || imageWorking || analyzing || overviewWorking" @click="generateAssetPrompts">生成资产提示词（{{ selectedAssetCount }}）</v-btn>
          <v-menu><template #activator="{ props }"><v-btn v-bind="props" block variant="text" prepend-icon="mdi-download-outline" append-icon="mdi-chevron-down" class="mt-2" :disabled="!hasImageResults || imageWorking">导出图片文档</v-btn></template><v-list density="compact"><v-list-item title="Markdown（.md）" @click="exportImages('md')" /><v-list-item title="文本（.txt）" @click="exportImages('txt')" /></v-list></v-menu>
          <v-btn v-if="imageWorking" block color="error" variant="tonal" prepend-icon="mdi-stop" class="mt-2" @click="stopAnalysis">停止图片分析</v-btn>
        </section>
        <section class="action-section">
          <h2>视频反推</h2>
          <label>输出模板</label>
          <v-btn-toggle v-model="selectedVideoTemplates" class="video-template-toggle" density="compact" multiple mandatory divided><v-btn value="video-prompt">视频提示词</v-btn><v-btn value="script">剧本</v-btn></v-btn-toggle>
          <v-btn v-if="!analyzing" block color="primary" variant="flat" prepend-icon="mdi-movie-search-outline" class="mt-3" :disabled="!boundariesConfirmed || !shots.length || !selectedVideoTemplates.length || imageWorking || overviewWorking" @click="analyzeShots">开始视频反推</v-btn>
          <v-btn v-else block color="error" variant="tonal" prepend-icon="mdi-stop" class="mt-3" @click="stopAnalysis">停止视频反推</v-btn>
          <v-menu><template #activator="{ props }"><v-btn v-bind="props" block variant="text" prepend-icon="mdi-download-outline" append-icon="mdi-chevron-down" class="mt-2" :disabled="!hasSelectedVideoResults || analyzing">导出视频文档</v-btn></template><v-list density="compact"><v-list-item title="Markdown（.md）" @click="exportVideos('md')" /><v-list-item title="文本（.txt）" @click="exportVideos('txt')" /></v-list></v-menu>
          <v-divider class="my-4" />
          <h2>完整提示词</h2>
          <label>片段时长：{{ targetPromptSeconds }} 秒</label>
          <v-slider v-model="targetPromptSeconds" :min="4" :max="30" :step="1" :ticks="durationTicks" show-ticks="always" hide-details class="duration-slider" />
          <v-btn block color="primary" variant="flat" prepend-icon="mdi-movie-filter-outline" class="mt-3" :loading="overviewWorking" :disabled="!hasAllVideoPrompts || analyzing || imageWorking || overviewWorking" @click="generateOverview">{{ videoOverview ? '更新全片总览' : '生成全片总览' }}</v-btn>
          <v-btn v-if="overviewWorking" block color="error" variant="tonal" prepend-icon="mdi-stop" class="mt-2" @click="stopAnalysis">停止生成总览</v-btn>
          <v-menu><template #activator="{ props }"><v-btn v-bind="props" block variant="text" prepend-icon="mdi-file-document-check-outline" append-icon="mdi-chevron-down" class="mt-2" :disabled="!videoOverview || !hasAllVideoPrompts || overviewWorking">导出完整视频提示词</v-btn></template><v-list density="compact"><v-list-item title="Markdown（.md）" @click="exportCompletePrompts('md')" /><v-list-item title="文本（.txt）" @click="exportCompletePrompts('txt')" /></v-list></v-menu>
        </section>
        <p class="progress-message">{{ progressMessage }}</p>
      </aside>
    </section>

    <AppSettingsDialog v-model="settingsOpen" />
    <v-dialog v-model="sourceDialogOpen" max-width="480" :persistent="downloadingSource">
      <v-card title="导入视频链接">
        <v-card-text>
          <v-text-field v-model="sourceUrl" label="视频链接" placeholder="https://..." variant="outlined" autofocus :disabled="downloadingSource" @keyup.enter="downloadSource" />
          <p class="source-note">仅支持公开的单条视频。请仅下载有权使用的内容。</p>
          <v-alert v-if="sourceDownloadError" type="error" variant="tonal" density="compact">{{ sourceDownloadError }}</v-alert>
          <p v-if="downloadingSource" class="source-progress">{{ progressMessage || '正在下载…' }}</p>
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn v-if="!downloadingSource" variant="text" @click="sourceDialogOpen = false">取消</v-btn><v-btn v-if="downloadingSource" color="error" variant="tonal" prepend-icon="mdi-stop" @click="stopSourceDownload">停止下载</v-btn><v-btn v-else color="primary" variant="flat" :disabled="!sourceUrl.trim()" @click="downloadSource">下载并导入</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppSettingsDialog from '@/components/AppSettingsDialog.vue'
import { appTextModel as textModel } from '@/runtime/appSettings'
import { editFilmBreakdownShots, filmBreakdownMediaUrl, formatFilmBreakdownTime, type FilmBreakdownAsset, type FilmBreakdownAssetCategory, type FilmBreakdownEditAction, type FilmBreakdownFramePosition, type FilmBreakdownShot, type FilmBreakdownVideoOverview, type FilmBreakdownVideoTemplate } from '@/runtime/filmBreakdown'

type ProjectHistoryItem = { name: string; rootPath: string }
const router = useRouter()
const HISTORY_KEY = 'jc-film-breakdown-project-history'
const storedHistory = (() => { try { const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(value) ? value : [] } catch { return [] } })()
const projectHistory = ref<ProjectHistoryItem[]>(storedHistory)
const projectRoot = ref('')
const sourceFileName = ref('')
const sourceFingerprint = ref('')
const shots = ref<FilmBreakdownShot[]>([])
const imageAssets = ref<FilmBreakdownAsset[]>([])
const videoOverview = ref<FilmBreakdownVideoOverview>()
const boundariesConfirmed = ref(false)
const selectedShotId = ref('')
const sourceVideo = ref<HTMLVideoElement | null>(null)
const playheadMs = ref(0)
const previewEndMs = ref<number | null>(null)
let previewTimer: number | undefined
const threshold = ref(.3)
const thresholds = [{ title: '灵敏', value: .2 }, { title: '标准', value: .3 }, { title: '稳健', value: .4 }]
const detecting = ref(false)
const preparing = ref(false)
const analyzing = ref(false)
const imageWorking = ref(false)
const overviewWorking = ref(false)
const selectedFramePositions = ref<FilmBreakdownFramePosition[]>(['start'])
const selectedVideoTemplates = ref<FilmBreakdownVideoTemplate[]>(['video-prompt'])
const resultView = ref<'shots' | 'assets' | 'overview'>('shots')
const targetPromptSeconds = ref(15)
const durationTicks = { 4: '4', 10: '10', 15: '15', 20: '20', 25: '25', 30: '30' }
const progressMessage = ref('')
const settingsOpen = ref(false)
const sourceDialogOpen = ref(false)
const sourceUrl = ref('')
const downloadingSource = ref(false)
const sourceDownloadError = ref('')

const sourceVideoUrl = computed(() => sourceFileName.value && projectRoot.value ? `${filmBreakdownMediaUrl(projectRoot.value, '视频', sourceFileName.value)}&v=${sourceFingerprint.value}` : '')
const selectedShot = computed(() => shots.value.find((shot) => shot.shotId === selectedShotId.value))
const selectedAssetCount = computed(() => imageAssets.value.filter((asset) => asset.selected && asset.status !== 'ready').length)
const hasImageResults = computed(() => shots.value.some((shot) => Object.values(shot.imagePrompts || {}).some((prompt) => prompt?.trim())) || imageAssets.value.some((asset) => asset.status === 'ready' && asset.prompt.trim()))
const hasSelectedVideoResults = computed(() => shots.value.some((shot) => selectedVideoTemplates.value.some((template) => videoResult(shot, template).trim())))
const hasAllVideoPrompts = computed(() => shots.value.length > 0 && shots.value.every((shot) => videoResult(shot, 'video-prompt').trim()))
const assetGroups = computed(() => ([['character', '角色'], ['scene', '场景'], ['prop', '关键道具']] as const).map(([category, title]) => ({ category, title, assets: imageAssets.value.filter((asset) => asset.category === category) })))
const stopProgress = window.electron.filmBreakdownProject.onProgress((message) => { progressMessage.value = message })
onBeforeUnmount(() => { stopProgress(); clearPreviewTimer(); if (downloadingSource.value) void window.electron.filmBreakdownProject.stopSourceDownload() })

function rememberProject(project: ProjectHistoryItem) { projectHistory.value = [project, ...projectHistory.value.filter((item) => item.rootPath !== project.rootPath)].slice(0, 20); localStorage.setItem(HISTORY_KEY, JSON.stringify(projectHistory.value)) }
async function chooseProject() { const project = await window.electron.filmBreakdownProject.choose(); if (!project) return null; projectRoot.value = project.rootPath; rememberProject(project); await loadProject(); return project }
async function switchProject(value: unknown) { if (typeof value !== 'string' || !value) return; projectRoot.value = value; await loadProject() }
async function loadProject() { const state = await window.electron.filmBreakdownProject.load(projectRoot.value); sourceFileName.value = state.source?.fileName || ''; sourceFingerprint.value = state.source?.fingerprint || ''; shots.value = state.shots; imageAssets.value = state.imageAssets || []; videoOverview.value = state.videoOverview; threshold.value = state.detectionThreshold; boundariesConfirmed.value = state.boundariesConfirmed; selectedShotId.value = state.shots[0]?.shotId || '' }
function applySource(source: { rootPath: string; name: string; fileName: string; fingerprint: string }) { projectRoot.value = source.rootPath; rememberProject(source); sourceFileName.value = source.fileName; sourceFingerprint.value = source.fingerprint; shots.value = []; imageAssets.value = []; videoOverview.value = undefined; boundariesConfirmed.value = false; selectedShotId.value = '' }
async function chooseSource() { const source = await window.electron.filmBreakdownProject.chooseSource(projectRoot.value || undefined); if (source) applySource(source) }
function openSourceDialog() { sourceDownloadError.value = ''; sourceDialogOpen.value = true }
async function downloadSource() {
  if (downloadingSource.value || !sourceUrl.value.trim()) return
  sourceDownloadError.value = ''
  if (!projectRoot.value && !(await chooseProject())) return
  downloadingSource.value = true
  progressMessage.value = '正在解析视频链接…'
  try { const source = await window.electron.filmBreakdownProject.downloadSource(projectRoot.value, sourceUrl.value); applySource(source); sourceUrl.value = ''; sourceDialogOpen.value = false; progressMessage.value = '视频已下载并导入' }
  catch (error) { sourceDownloadError.value = error instanceof Error ? error.message : String(error) }
  finally { downloadingSource.value = false }
}
async function stopSourceDownload() { await window.electron.filmBreakdownProject.stopSourceDownload(); progressMessage.value = '正在停止下载…' }
async function showProject() { if (projectRoot.value) await window.electron.filmBreakdownProject.show(projectRoot.value) }
async function detectShots() { detecting.value = true; progressMessage.value = '正在准备镜头检测…'; try { const result = await window.electron.filmBreakdownProject.detect(projectRoot.value, threshold.value); shots.value = result.shots; imageAssets.value = []; videoOverview.value = undefined; boundariesConfirmed.value = false; selectedShotId.value = shots.value[0]?.shotId || '' } catch (error) { progressMessage.value = error instanceof Error ? error.message : String(error) } finally { detecting.value = false } }
async function editShot(action: FilmBreakdownEditAction) { if (!selectedShot.value) return; const index = shots.value.findIndex((shot) => shot.shotId === selectedShotId.value); const next = editFilmBreakdownShots(shots.value, selectedShotId.value, action, playheadMs.value); if (next === shots.value) return; const result = await window.electron.filmBreakdownProject.saveShots(projectRoot.value, next); shots.value = result.shots; imageAssets.value = []; videoOverview.value = undefined; boundariesConfirmed.value = false; selectedShotId.value = shots.value[Math.min(index, shots.value.length - 1)]?.shotId || '' }
async function confirmShots() { preparing.value = true; try { const result = await window.electron.filmBreakdownProject.confirmShots(projectRoot.value); shots.value = result.shots; boundariesConfirmed.value = true } catch (error) { progressMessage.value = error instanceof Error ? error.message : String(error) } finally { preparing.value = false } }
function clearPreviewTimer() { if (previewTimer !== undefined) window.clearTimeout(previewTimer); previewTimer = undefined }
function finishShotPreview(video: HTMLVideoElement, startMs: number, endMs: number) { clearPreviewTimer(); video.pause(); const stopMs = Math.max(startMs, endMs - 35); if (video.currentTime * 1000 > stopMs) video.currentTime = stopMs / 1000; playheadMs.value = stopMs; previewEndMs.value = null }
async function selectShot(shot: FilmBreakdownShot) { selectedShotId.value = shot.shotId; const video = sourceVideo.value; if (!video) return; clearPreviewTimer(); video.pause(); previewEndMs.value = shot.endMs; video.currentTime = shot.startMs / 1000; try { await video.play(); previewTimer = window.setTimeout(() => finishShotPreview(video, shot.startMs, shot.endMs), Math.max(0, (shot.endMs - shot.startMs - 35) / Math.max(.1, video.playbackRate))) } catch { previewEndMs.value = null } }
function stopShotPreview() { const video = sourceVideo.value; if (!video) return; playheadMs.value = Math.round(video.currentTime * 1000); const shot = selectedShot.value; if (shot && previewEndMs.value !== null && playheadMs.value >= shot.endMs) finishShotPreview(video, shot.startMs, shot.endMs) }
async function savePrompt(shot: FilmBreakdownShot) { await window.electron.filmBreakdownProject.savePrompt(projectRoot.value, shot.shotId, shot.videoPrompt, shot.imagePrompt); videoOverview.value = undefined }
async function saveVideoResult(shot: FilmBreakdownShot, template: FilmBreakdownVideoTemplate, event: Event) { const prompt = (event.target as HTMLTextAreaElement).value; shot.videoResults = { ...shot.videoResults, [template]: prompt }; if (template === 'video-prompt') shot.videoPrompt = prompt; await window.electron.filmBreakdownProject.saveVideoResult(projectRoot.value, shot.shotId, template, prompt); if (template === 'video-prompt') videoOverview.value = undefined }
async function saveFramePrompt(shot: FilmBreakdownShot, position: FilmBreakdownFramePosition) { await window.electron.filmBreakdownProject.saveFramePrompt(projectRoot.value, shot.shotId, position, shot.imagePrompts?.[position] || '') }
async function saveAssetPrompt(asset: FilmBreakdownAsset) { await window.electron.filmBreakdownProject.saveAssetPrompt(projectRoot.value, asset.assetId, asset.prompt) }
async function runImageTask(task: () => Promise<void>) { imageWorking.value = true; try { await task() } catch (error) { progressMessage.value = error instanceof Error ? error.message : String(error); await loadProject() } finally { imageWorking.value = false } }
async function identifyAssets() { await runImageTask(async () => { progressMessage.value = '正在准备资产分析…'; const result = await window.electron.filmBreakdownProject.identifyAssets(projectRoot.value, textModel.value as import('~/electron/types').TextModel); imageAssets.value = result.assets; resultView.value = 'assets' }) }
async function generateFramePrompts() { await runImageTask(async () => { const result = await window.electron.filmBreakdownProject.generateFramePrompts(projectRoot.value, textModel.value as import('~/electron/types').TextModel, selectedFramePositions.value); shots.value = result.shots; resultView.value = 'shots' }) }
async function generateAssetPrompts() { await runImageTask(async () => { const result = await window.electron.filmBreakdownProject.generateAssetPrompts(projectRoot.value, textModel.value as import('~/electron/types').TextModel); imageAssets.value = result.assets; resultView.value = 'assets' }) }
async function exportImages(format: 'md' | 'txt') { const file = await window.electron.filmBreakdownProject.exportImages(projectRoot.value, format); if (file) progressMessage.value = `已导出：${file}` }
async function exportVideos(format: 'md' | 'txt') { const file = await window.electron.filmBreakdownProject.exportVideos(projectRoot.value, selectedVideoTemplates.value, format); if (file) progressMessage.value = `已导出：${file}` }
async function generateOverview() { overviewWorking.value = true; progressMessage.value = '正在准备全片总览…'; try { const result = await window.electron.filmBreakdownProject.generateOverview(projectRoot.value, textModel.value as import('~/electron/types').TextModel); videoOverview.value = result.videoOverview; resultView.value = 'overview' } catch (error) { progressMessage.value = error instanceof Error ? error.message : String(error) } finally { overviewWorking.value = false } }
async function saveOverview() { if (!videoOverview.value) return; try { const result = await window.electron.filmBreakdownProject.saveOverview(projectRoot.value, videoOverview.value); videoOverview.value = result.videoOverview; progressMessage.value = '项目总览已保存' } catch (error) { progressMessage.value = error instanceof Error ? error.message : String(error) } }
async function saveOverviewConstraints(event: Event) { if (!videoOverview.value) return; videoOverview.value.technicalConstraints = (event.target as HTMLTextAreaElement).value.split('\n').map((value) => value.trim()).filter(Boolean); await saveOverview() }
async function exportCompletePrompts(format: 'md' | 'txt') { try { const file = await window.electron.filmBreakdownProject.exportCompletePrompts(projectRoot.value, targetPromptSeconds.value, format); if (file) progressMessage.value = `已导出：${file}` } catch (error) { progressMessage.value = error instanceof Error ? error.message : String(error) } }
async function persistAssetSelection() { const result = await window.electron.filmBreakdownProject.saveAssetSelection(projectRoot.value, imageAssets.value.filter((asset) => asset.selected).map((asset) => asset.assetId)); imageAssets.value = result.assets }
function toggleAsset(assetId: string) { const asset = imageAssets.value.find((item) => item.assetId === assetId); if (!asset) return; asset.selected = !asset.selected; void persistAssetSelection() }
function toggleAssetGroup(category: FilmBreakdownAssetCategory) { const assets = imageAssets.value.filter((asset) => asset.category === category); const selected = !assets.every((asset) => asset.selected); assets.forEach((asset) => { asset.selected = selected }); void persistAssetSelection() }
async function analyzeShots() { analyzing.value = true; progressMessage.value = '正在开始视频反推…'; try { const templates = [...selectedVideoTemplates.value].map(String) as FilmBreakdownVideoTemplate[]; const result = await window.electron.filmBreakdownProject.analyze(String(projectRoot.value), textModel.value as import('~/electron/types').TextModel, templates); shots.value = result.shots } catch (error) { progressMessage.value = error instanceof Error ? error.message : String(error); await loadProject() } finally { analyzing.value = false } }
async function stopAnalysis() { await window.electron.filmBreakdownProject.stopAnalysis(projectRoot.value); progressMessage.value = '正在停止…' }
function openSettings() { settingsOpen.value = true }
function mediaFrameUrl(fileName: string) { return `${filmBreakdownMediaUrl(projectRoot.value, '图片', fileName)}&v=${sourceFingerprint.value}` }
function shotFrameUrl(shot: FilmBreakdownShot) { return mediaFrameUrl(shot.frameFileNames?.start || shot.frameFileName || '') }
function assetFrameUrl(asset: FilmBreakdownAsset) { return mediaFrameUrl(asset.representative.fileName) }
function shotImageEntries(shot: FilmBreakdownShot) { const names: Record<FilmBreakdownFramePosition, string> = { start: '首帧', middle: '中间帧', end: '尾帧' }; return (Object.keys(shot.imagePrompts || {}) as FilmBreakdownFramePosition[]).filter((position) => shot.imagePrompts?.[position] !== undefined).map((position) => ({ position, title: names[position] })) }
function videoResult(shot: FilmBreakdownShot, template: FilmBreakdownVideoTemplate) { return shot.videoResults?.[template] || (template === 'video-prompt' ? shot.videoPrompt : '') }
function shotVideoEntries(shot: FilmBreakdownShot) { const names: Record<FilmBreakdownVideoTemplate, string> = { 'video-prompt': '视频提示词', script: '剧本' }; return (['video-prompt', 'script'] as const).filter((template) => selectedVideoTemplates.value.includes(template) || videoResult(shot, template).trim()).map((template) => ({ template, title: names[template], value: videoResult(shot, template) })) }
function assetCategoryName(category: FilmBreakdownAssetCategory) { return ({ character: '角色', scene: '场景', prop: '关键道具' })[category] }
function formatTime(value: number) { return formatFilmBreakdownTime(value) }
function statusText(value: FilmBreakdownShot['analysisStatus']) { return ({ pending: '待分析', running: '分析中', ready: '已完成', failed: '失败' })[value] }
function statusColor(value: FilmBreakdownShot['analysisStatus']) { return ({ pending: 'default', running: 'primary', ready: 'success', failed: 'error' })[value] }
</script>

<style scoped>
.desk-shell { height: 100%; padding-top: 40px; display: grid; grid-template-rows: 52px minmax(0, 1fr); background: #f6f7f5; color: #17211a; }
.project-bar { display: flex; align-items: center; gap: 7px; padding: 0 12px; border-bottom: 1px solid #dfe5df; background: #fff; }.project-select { width: 280px; }.product-switch { display: inline-flex; border: 1px solid #d6ded7; border-radius: 5px; overflow: hidden; }.product-switch button { height: 30px; padding: 0 9px; border: 0; background: #fff; color: #667168; font: inherit; font-size: 12px; cursor: pointer; }.product-switch button.active { background: #e8f5eb; color: #176b37; font-weight: 650; }.workflow-title { display: flex; align-items: center; gap: 7px; color: #176b37; font-size: 13px; }.workflow-title span { color: #7b867d; font-size: 12px; font-weight: 400; }
.breakdown-workspace { min-height: 0; display: grid; grid-template-columns: minmax(300px, 360px) minmax(540px, 1fr) 300px; gap: 12px; padding: 12px; }.source-preview, .shot-panel, .actions-panel { min-width: 0; border: 1px solid #dfe5df; border-radius: 6px; background: #fff; overflow: auto; }.source-preview { display: grid; align-content: start; padding: 10px; }.video-stage { width: 100%; aspect-ratio: 16 / 9; background: #1d2420; color: #d8e2da; }.empty-stage { display: grid; place-content: center; }.video-meta { display: flex; justify-content: space-between; gap: 8px; padding: 11px 2px; color: #68736a; font-size: 12px; }.video-meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-sidebar { margin: 4px -2px 0; border-top: 1px solid #e4e9e4; }.asset-sidebar header { display: flex; align-items: center; justify-content: space-between; padding: 14px 4px 10px; }.asset-sidebar h2 { margin: 0; font-size: 14px; }.asset-sidebar p { margin: 3px 0 0; color: #778179; font-size: 11px; }.asset-empty { padding: 24px 10px; border: 1px dashed #d8dfd8; color: #8a948c; text-align: center; font-size: 12px; }.asset-group { margin-bottom: 12px; }.asset-group-title { display: flex; align-items: center; gap: 7px; padding: 6px 3px; font-size: 12px; font-weight: 650; }.asset-group-title span { margin-left: auto; color: #7d887f; font-weight: 400; }.asset-item { min-height: 48px; display: grid; grid-template-columns: 18px 62px minmax(0, 1fr); align-items: center; gap: 7px; padding: 5px 3px; border-top: 1px solid #eef1ee; cursor: pointer; }.asset-item img { width: 62px; aspect-ratio: 16 / 9; object-fit: cover; background: #1d2420; }.asset-item span { min-width: 0; display: flex; flex-direction: column; gap: 3px; }.asset-item strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }.asset-item small { color: #778179; font-size: 10px; }
.panel-heading { min-height: 76px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e6ebe6; }.panel-heading h1 { margin: 0; font-size: 16px; }.panel-heading p { margin: 4px 0 0; color: #6c766f; font-size: 12px; }.empty-list { min-height: 280px; display: grid; place-content: center; justify-items: center; gap: 8px; color: #89938b; }.shot-row { position: relative; display: grid; grid-template-columns: 112px 150px minmax(240px, 1fr); gap: 12px; padding: 12px 58px 12px 14px; border-bottom: 1px solid #e8ece8; cursor: pointer; }.shot-row.selected { background: #f2faf3; box-shadow: inset 3px 0 #26944a; }.shot-index { display: flex; flex-direction: column; gap: 5px; }.shot-index strong { font-size: 13px; }.shot-index span, .shot-index small { color: #6d786f; font-size: 11px; }.shot-frame { width: 150px; aspect-ratio: 16 / 9; object-fit: contain; background: #1d2420; }.frame-placeholder { display: grid; place-content: center; color: #99a39b; }.shot-copy { min-width: 0; }.shot-copy label, .action-section label { display: block; margin: 0 0 4px; color: #657168; font-size: 11px; }.shot-copy textarea { box-sizing: border-box; width: 100%; min-height: 66px; margin-bottom: 8px; padding: 7px; border: 1px solid #d6ded7; border-radius: 4px; resize: vertical; color: inherit; font: inherit; font-size: 12px; line-height: 1.5; }.shot-status { position: absolute; top: 12px; right: 10px; }.shot-error { margin: 0; color: #b3261e; font-size: 11px; }
.asset-result-row { position: relative; display: grid; grid-template-columns: 170px minmax(0, 1fr) auto; align-items: start; gap: 14px; padding: 14px; border-bottom: 1px solid #e8ece8; }.asset-result-row > img { width: 170px; aspect-ratio: 16 / 9; object-fit: contain; background: #1d2420; }.asset-result-copy { min-width: 0; }.asset-result-copy > div { display: flex; align-items: baseline; gap: 9px; }.asset-result-copy span, .asset-result-copy p { color: #6d786f; font-size: 11px; }.asset-result-copy p { margin: 5px 0 9px; }.asset-result-copy textarea { box-sizing: border-box; width: 100%; min-height: 110px; padding: 8px; border: 1px solid #d6ded7; border-radius: 4px; resize: vertical; color: inherit; font: inherit; font-size: 12px; line-height: 1.5; }
.overview-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; padding: 16px; }.overview-form > label { display: grid; gap: 5px; color: #526057; font-size: 12px; }.overview-form textarea { box-sizing: border-box; width: 100%; min-height: 110px; padding: 8px; border: 1px solid #d6ded7; border-radius: 4px; resize: vertical; color: inherit; font: inherit; line-height: 1.5; }.role-list { grid-column: 1 / -1; }.role-list h2 { margin: 0 0 8px; font-size: 14px; }.role-list label { display: grid; grid-template-columns: 90px minmax(0, 1fr); align-items: center; gap: 8px; padding: 5px 0; border-top: 1px solid #edf0ed; font-size: 12px; }.role-list input { height: 32px; box-sizing: border-box; padding: 0 8px; border: 1px solid #d6ded7; border-radius: 4px; color: inherit; font: inherit; }
.actions-panel { padding: 0 16px; }.action-section { padding: 16px 0; border-bottom: 1px solid #e4e9e4; }.action-section h2 { margin: 0 0 10px; font-size: 15px; }.action-section p { margin: 0 0 10px; color: #6c766f; font-size: 12px; }.frame-toggle, .video-template-toggle { width: 100%; }.frame-toggle :deep(.v-btn), .video-template-toggle :deep(.v-btn) { min-width: 0; flex: 1 1 0; padding-inline: 6px; }.progress-message { padding: 14px 0; color: #617067; font-size: 12px; line-height: 1.45; }
@media (max-width: 1100px) { .project-select { width: 190px; }.breakdown-workspace { grid-template-columns: minmax(280px, 340px) minmax(500px, 1fr); }.actions-panel { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }.action-section { border-bottom: 0; } }
.action-progress { margin: 8px 0 0; color: #617067; font-size: 11px; line-height: 1.4; }
.duration-slider { margin-top: 28px; padding-inline: 4px; }
.source-lock .shot-panel, .source-lock .actions-panel { pointer-events: none; opacity: .65; }
.source-note, .source-progress { margin: 0 0 12px; color: #68736a; font-size: 12px; line-height: 1.5; }.source-progress { color: #176b37; }
</style>
