<template>
  <v-dialog v-model="open" max-width="560">
    <v-card prepend-icon="mdi-cog-outline" title="设置">
      <v-card-text class="settings-content">
        <v-select v-model="selectedModel" :items="textModelItems" label="文本与视频理解模型" hide-details />
        <div class="settings-row">
          <v-text-field v-model="apiKey" label="API Key" :type="showApiKey ? 'text' : 'password'" :append-inner-icon="showApiKey ? 'mdi-eye-off-outline' : 'mdi-eye-outline'" autocomplete="off" hide-details @click:append-inner="showApiKey = !showApiKey" />
          <v-btn variant="tonal" @click="openKeysPage">前往设置</v-btn>
        </div>
        <p class="settings-status">{{ apiKeyStatus }}</p>
        <v-divider />
        <div class="settings-engine">
          <div><strong>本地字幕引擎</strong><p>{{ funAsrStatus?.message || '正在检查安装状态…' }}</p><p v-if="funAsrProgress">{{ funAsrProgress }}</p></div>
          <v-btn icon="mdi-refresh" size="small" variant="text" title="扫描、验证并绑定本机已有引擎" :loading="checkingFunAsr" @click="checkFunAsr" />
          <v-btn :color="funAsrStatus?.state === 'ready' ? undefined : 'primary'" :variant="funAsrStatus?.state === 'ready' ? 'tonal' : 'flat'" :loading="installingFunAsr" :disabled="installingFunAsr || funAsrStatus?.state === 'ready'" @click="installFunAsr">{{ funAsrStatus?.state === 'ready' ? '已就绪' : '一键安装' }}</v-btn>
        </div>
        <div class="settings-engine"><div><strong>媒体导出引擎</strong><p>{{ ffmpegStatus?.message || '正在检查内置 FFmpeg…' }}</p></div></div>
      </v-card-text>
      <v-card-actions><v-spacer /><v-btn variant="text" @click="open = false">关闭</v-btn><v-btn :loading="testingApiKey" variant="tonal" @click="testApiKey">测试连接</v-btn><v-btn color="primary" @click="saveSettings">保存</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { appTextModel, saveAppTextModel, textModelItems } from '@/runtime/appSettings'
import type { TextModel } from '~/electron/types'

type EngineStatus = { state: 'ready' | 'missing' | 'installing' | 'failed'; message: string }
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ subtitleEngineStatus: [status: EngineStatus] }>()
const selectedModel = ref<TextModel>(appTextModel.value)
const apiKey = ref('')
const apiKeySaved = ref(false)
const apiKeyMessage = ref('')
const showApiKey = ref(false)
const testingApiKey = ref(false)
const installingFunAsr = ref(false)
const checkingFunAsr = ref(false)
const funAsrProgress = ref('')
const funAsrStatus = ref<EngineStatus | null>(null)
const ffmpegStatus = ref<{ state: 'ready' | 'failed'; message: string } | null>(null)
const apiKeyStatus = computed(() => apiKeyMessage.value || (apiKeySaved.value ? 'API Key 已保存。' : '尚未配置 API Key。'))

async function refreshStatus() {
  const [hasKey, funAsr, subtitleEngine, ffmpeg] = await Promise.all([
    window.electron.cloud.hasApiKey(),
    window.electron.cloud.funAsrInstallStatus(),
    window.electron.cloud.funAsrSubtitleInstallStatus(),
    window.electron.cloud.ffmpegStatus(),
  ])
  apiKeySaved.value = hasKey
  funAsrStatus.value = funAsr
  ffmpegStatus.value = ffmpeg
  emit('subtitleEngineStatus', subtitleEngine)
}

watch(open, (value) => {
  if (!value) return
  selectedModel.value = appTextModel.value
  void refreshStatus()
}, { immediate: true })

const stopFunAsrProgress = window.electron.cloud.onFunAsrInstallProgress((message) => { funAsrProgress.value = message })
onBeforeUnmount(stopFunAsrProgress)

async function checkFunAsr() {
  checkingFunAsr.value = true
  funAsrProgress.value = '正在搜索、验证并绑定本机已有引擎…'
  try {
    const [funAsr, subtitleEngine, ffmpeg] = await Promise.all([
      window.electron.cloud.scanFunAsr(),
      window.electron.cloud.funAsrSubtitleInstallStatus(),
      window.electron.cloud.ffmpegStatus(),
    ])
    funAsrStatus.value = funAsr
    ffmpegStatus.value = ffmpeg
    emit('subtitleEngineStatus', subtitleEngine)
  } catch (error) {
    funAsrStatus.value = { state: 'failed', message: `扫描失败：${error instanceof Error ? error.message : String(error)}` }
  } finally {
    checkingFunAsr.value = false
    funAsrProgress.value = ''
  }
}

async function saveSettings() {
  if (apiKey.value.trim()) await window.electron.cloud.saveApiKey(apiKey.value)
  saveAppTextModel(selectedModel.value)
  apiKeySaved.value = await window.electron.cloud.hasApiKey()
  apiKeyMessage.value = ''
  apiKey.value = ''
  open.value = false
}

async function testApiKey() {
  testingApiKey.value = true
  apiKeyMessage.value = '正在连接云端…'
  try {
    if (apiKey.value.trim()) await window.electron.cloud.saveApiKey(apiKey.value)
    await window.electron.cloud.testApiKey(selectedModel.value)
    apiKeySaved.value = true
    apiKeyMessage.value = '云端连接成功。'
  } catch (error) {
    apiKeyMessage.value = `连接失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    testingApiKey.value = false
  }
}

async function installFunAsr() {
  installingFunAsr.value = true
  funAsrProgress.value = '正在开始安装…'
  try {
    funAsrStatus.value = await window.electron.cloud.installFunAsr()
    const subtitleEngine = await window.electron.cloud.funAsrSubtitleInstallStatus()
    emit('subtitleEngineStatus', subtitleEngine)
  } finally {
    installingFunAsr.value = false
    funAsrProgress.value = ''
  }
}

function openKeysPage() { window.electron.openExternal({ url: 'https://api.jiucaihezi.studio/keys' }) }
</script>

<style scoped>
.settings-content { display: grid; gap: 16px; }
.settings-row, .settings-engine { display: flex; align-items: center; gap: 10px; }
.settings-row > :first-child { flex: 1; }
.settings-status, .settings-engine p { margin: 0; color: #68736a; font-size: 12px; }
.settings-engine { justify-content: space-between; }
.settings-engine strong { font-size: 14px; }
</style>
