<template>
  <main class="desk-shell">
    <header class="project-bar">
      <v-btn color="primary" variant="flat" size="small" prepend-icon="mdi-folder-plus-outline" @click="chooseProject">选择项目</v-btn>
      <v-select v-model="projectRoot" class="project-select" :items="projectHistory" item-title="name" item-value="rootPath" density="compact" variant="outlined" hide-details placeholder="未选择项目" aria-label="选择项目" @update:model-value="switchProject" />
      <v-btn icon="mdi-pencil-outline" variant="text" size="small" title="重命名项目" :disabled="!projectRoot" @click="openRenameProject" />
      <v-btn icon="mdi-folder-open-outline" variant="text" size="small" title="在访达中显示" :disabled="!projectRoot" @click="showProject" />
      <v-divider vertical class="mx-2" />
      <nav class="workspace-nav" aria-label="工作台">
        <button :class="{ active: workspace === 'captions' }" @click="workspace = 'captions'">
          <v-icon size="18">mdi-subtitles-outline</v-icon>字幕工作台
          <v-icon v-if="workspace === 'captions'" size="16" color="primary">mdi-check-circle</v-icon>
        </button>
        <v-icon size="18" class="workspace-arrow">mdi-chevron-right</v-icon>
        <button :class="{ active: workspace === 'structure' }" @click="enterStructureWorkspace">
          <v-icon size="18">mdi-file-tree-outline</v-icon>结构编辑工作台
        </button>
      </nav>
      <v-spacer />
      <v-btn icon="mdi-cog-outline" variant="text" size="small" title="设置" aria-label="设置" @click="openSettings" />
    </header>

    <section v-if="workspace === 'captions'" class="caption-workspace">
      <section class="source-preview" aria-label="视频预览">
        <video v-if="sourceFileName" ref="sourceVideo" class="video-stage" controls :src="sourceVideoUrl" @loadedmetadata="readSourceAspect" @timeupdate="syncCaptionPlayhead" @seeked="syncCaptionPlayhead" />
        <div v-else class="video-stage" role="button" tabindex="0" @click="chooseSource">
          <v-btn color="primary" variant="flat" prepend-icon="mdi-upload" @click.stop="chooseSource">上传口播视频</v-btn>
        </div>
        <div class="video-meta"><span>{{ sourceFileName ? '已导入原始口播' : '尚未导入视频' }}</span><v-btn v-if="sourceFileName" size="x-small" variant="text" color="primary" prepend-icon="mdi-swap-horizontal" @click="confirmReplaceSource">更换视频</v-btn></div>
      </section>
      <section class="caption-table-wrap">
        <header class="panel-heading">
          <div><h1>字幕工作台</h1><p>识别、校准并确认原话与时间码</p></div>
          <v-chip size="small" color="primary" variant="tonal">{{ sourceCues.length }} 条字幕</v-chip>
        </header>
        <table class="caption-table">
          <thead><tr><th>序号</th><th>时间轴</th><th>识别原文</th><th>人工确认稿</th></tr></thead>
          <tbody>
            <tr v-for="(cue, index) in sourceCues" :key="cue.cueId" :class="{ 'caption-selected': selectedCueId === cue.cueId }" @click="selectCue(cue)">
              <td><strong>#{{ String(index + 1).padStart(2, '0') }}</strong></td>
              <td>{{ formatTime(cue.startMs) }} - {{ formatTime(cue.endMs) }}</td>
              <td>{{ cue.recognizedText }}</td>
              <td>
                <textarea v-model="cue.confirmedText" aria-label="人工确认稿" @click.stop @change="saveCues" />
                <small v-if="semanticSuggestionsVisible" class="calibration-suggestion">校准建议：{{ semanticSuggestion(cue.cueId) }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <aside class="caption-actions">
        <section class="inspector-section">
          <h2>字幕处理</h2>
          <p class="engine-status" :class="`engine-${subtitleEngineStatus?.state || 'missing'}`">{{ transcriptionMessage || subtitleEngineStatus?.message || '正在检测本地字幕引擎…' }}</p>
          <v-btn block color="primary" variant="flat" prepend-icon="mdi-text-box-search-outline" :loading="recognizing" :disabled="!projectRoot || recognizing" @click="transcribe">识别字幕</v-btn>
          <label class="semantic-prompt-label" for="semantic-prompt">字幕校准要求</label>
          <textarea id="semantic-prompt" v-model="semanticPrompt" class="semantic-prompt" aria-label="字幕校准要求" />
          <div class="semantic-presets">
            <span>我的预设</span>
            <button v-for="preset in semanticPresets" :key="preset.name" :class="{ selected: semanticPrompt === preset.prompt }" @click="semanticPrompt = preset.prompt">{{ preset.name }}</button>
          </div>
          <div class="preset-save">
            <input v-model="semanticPresetName" aria-label="预设名称" placeholder="预设名称" @keyup.enter="saveSemanticPreset" />
            <v-btn icon="mdi-content-save-outline" size="small" variant="text" color="primary" title="保存为我的预设" @click="saveSemanticPreset" />
          </div>
          <v-btn block color="primary" variant="flat" prepend-icon="mdi-auto-fix" class="mt-2" :loading="calibrating" :disabled="!sourceCues.length || calibrating" @click="startSemanticCalibration">字幕校准</v-btn>
          <p v-if="calibrationMessage" class="calibration-status">{{ calibrationMessage }}</p>
          <template v-if="semanticSuggestionsVisible">
            <v-btn block color="primary" variant="flat" prepend-icon="mdi-check" class="mt-2" @click="applySemanticSuggestions">应用校准建议</v-btn>
            <v-btn block variant="text" prepend-icon="mdi-undo" class="mt-1" @click="undoSemanticCalibration">撤销本次校准</v-btn>
          </template>
          <v-btn v-if="semanticApplied" block variant="text" prepend-icon="mdi-restore" class="mt-1" @click="restoreRecognized">恢复并采用 FunASR 原文</v-btn>
        </section>
        <section class="inspector-section">
          <h2>播放头字幕编辑</h2>
          <p>当前位置 {{ formatPreciseTime(captionPlayheadMs) }}</p>
          <v-btn block color="primary" variant="tonal" prepend-icon="mdi-plus" @click="editCue('add')">在当前位置新增字幕</v-btn>
          <v-btn block variant="text" prepend-icon="mdi-content-cut" class="mt-1" @click="editCue('split')">在当前位置拆分所选字幕</v-btn>
          <v-btn block variant="text" prepend-icon="mdi-call-merge" class="mt-1" @click="editCue('merge-next')">与下一条字幕合并</v-btn>
          <v-btn block variant="text" prepend-icon="mdi-ray-start-vertex" class="mt-1" @click="editCue('set-start')">设为所选字幕开始</v-btn>
          <v-btn block variant="text" prepend-icon="mdi-ray-end" class="mt-1" @click="editCue('set-end')">设为所选字幕结束</v-btn>
          <v-btn block variant="text" color="error" prepend-icon="mdi-delete-outline" class="mt-1" @click="editCue('delete')">删除所选字幕</v-btn>
        </section>
        <section class="inspector-section inspector-confirm">
          <h2>字幕确认</h2>
          <v-btn block color="primary" variant="flat" prepend-icon="mdi-check-circle-outline" :disabled="!sourceCues.length" @click="confirmCaptions">确认字幕，进入结构编辑</v-btn>
          <p v-if="captionMessage" class="calibration-status">{{ captionMessage }}</p>
        </section>
      </aside>
    </section>

    <section v-else class="structure-workspace">
      <section class="final-preview-panel">
        <div class="final-video-stage">
          <video v-if="finalVideoUrl" class="preview-video" controls :src="finalVideoUrl" />
          <video v-else-if="sourceVideoUrl" ref="structureVideo" class="preview-video" controls :src="sourceVideoUrl" @loadedmetadata="readSourceAspect" @timeupdate="stopCuePreview" />
          <template v-else>
            <v-icon size="54">{{ finalRendered ? 'mdi-play-circle' : 'mdi-filmstrip' }}</v-icon>
            <strong>{{ finalRendered ? '口播剪辑成片' : '确认结构后生成成片' }}</strong>
            <small>{{ finalRendered ? `00:00 / ${estimatedDuration}` : '确认结构后生成成片' }}</small>
          </template>
          <div v-if="!finalVideoUrl && sourceVideoUrl" class="preview-output-frame" :style="previewOutputFrameStyle">
            <div v-if="previewHighlight?.cueId === previewCue?.cueId" class="focus-word-preview" :class="`focus-${previewHighlight.position || '左上'}`" :style="highlightPreviewStyle(previewHighlight)">{{ previewHighlight.phrase }}</div>
            <div class="subtitle-style-preview" :style="subtitlePreviewStyle">{{ previewCue?.confirmedText || '点击字幕预览' }}</div>
          </div>
        </div>
      </section>

      <section class="plan-panel">
        <header class="panel-heading compact">
          <div><h1>整理后口播稿</h1><p>{{ activeCues.length }} 个保留片段 · {{ removedCues.length }} 个待删除片段</p></div>
          <v-chip size="small" color="primary" variant="tonal">草稿方案</v-chip>
        </header>
        <article
          v-for="(cue, index) in activeCues"
          :key="cue.cueId"
          class="plan-cue"
          draggable="true"
          @click="previewPlanCue(cue)"
          @dragstart="draggingCueId = cue.cueId"
          @dragover.prevent
          @drop="dropCue(cue.cueId)"
        >
          <v-icon class="drag-handle" size="18">mdi-drag-vertical</v-icon>
          <div class="plan-cue-body"><small>#{{ cue.cueId.replace('cue-', '') }} · 原片 {{ formatTime(cue.startMs) }}</small><p>{{ cue.confirmedText }}</p><div class="highlight-row"><template v-if="highlightSuggestionForCue(cue.cueId)"><span>智能建议</span><button class="highlight-label" :style="highlightChipStyle(highlightSuggestionForCue(cue.cueId)!)" @click.stop="previewHighlightItem(highlightSuggestionForCue(cue.cueId)!)">{{ highlightSuggestionForCue(cue.cueId)!.phrase }}</button><em>{{ highlightSuggestionForCue(cue.cueId)!.position || '左上' }}</em><v-btn size="x-small" variant="text" color="primary" @click.stop="applyHighlight(highlightSuggestionForCue(cue.cueId)!)">替换</v-btn><v-btn icon="mdi-pencil-outline" size="x-small" variant="text" title="编辑花字" @click.stop="openAddHighlight(cue, highlightSuggestionForCue(cue.cueId)!)" /></template><template v-else-if="highlightForCue(cue.cueId)"><button class="highlight-label" :style="highlightChipStyle(highlightForCue(cue.cueId)!)" @click.stop="previewHighlightItem(highlightForCue(cue.cueId)!)">{{ highlightForCue(cue.cueId)!.phrase }}</button><select :value="highlightForCue(cue.cueId)!.style" aria-label="重点大字样式" @click.stop @change="changeHighlightStyle(cue.cueId, ($event.target as HTMLSelectElement).value)"><option v-for="template in highlightTemplates" :key="template.id" :value="template.id">{{ template.label }}</option></select><div class="position-choices"><button v-for="position in highlightPositions" :key="position" :class="{ active: (highlightForCue(cue.cueId)!.position || '左上') === position }" :title="position" @click.stop="changeHighlightPosition(cue.cueId, position)">{{ position }}</button></div><v-btn icon="mdi-pencil-outline" size="x-small" variant="text" title="编辑花字" @click.stop="openAddHighlight(cue, highlightForCue(cue.cueId)!)" /><v-btn icon="mdi-close" size="x-small" variant="text" title="移除重点大字" @click.stop="removeHighlight(cue.cueId)" /></template><v-btn v-else size="x-small" variant="text" color="primary" prepend-icon="mdi-plus" @click.stop="openAddHighlight(cue)">添加花字</v-btn></div></div>
          <div class="cue-actions">
            <v-btn icon="mdi-arrow-up" variant="text" size="x-small" :disabled="index === 0" title="上移" @click="move(cue.cueId, -1)" />
            <v-btn icon="mdi-arrow-down" variant="text" size="x-small" :disabled="index === activeCues.length - 1" title="下移" @click="move(cue.cueId, 1)" />
            <v-btn icon="mdi-delete-outline" variant="text" size="x-small" color="error" title="删除片段" @click="toggle(cue.cueId)" />
          </div>
        </article>
        <details v-if="removedCues.length" class="removed-cues">
          <summary>已删除片段（{{ removedCues.length }}）</summary>
          <div v-for="cue in removedCues" :key="cue.cueId" class="removed-cue"><span>{{ cue.confirmedText }}</span><v-btn size="x-small" variant="text" color="primary" @click="toggle(cue.cueId)">恢复</v-btn></div>
        </details>
      </section>

      <aside class="instruction-panel">
        <header class="panel-heading compact"><div><h1>编辑意见</h1></div></header>
        <textarea v-model="editorialNote" class="instruction-input" placeholder="输入你的整理要求。" />
        <div class="personal-presets">
          <span>我的预设</span>
          <button v-for="preset in editorialPresets" :key="preset.name" :class="{ selected: editorialNote === preset.prompt }" @click="selectEditorialPreset(preset.prompt)">{{ preset.name }}</button>
        </div>
        <div class="preset-save">
          <input v-model="editorialPresetName" aria-label="整理预设名称" placeholder="预设名称" @keyup.enter="saveEditorialPreset" />
          <v-btn icon="mdi-content-save-outline" size="small" variant="text" color="primary" title="保存为我的预设" @click="saveEditorialPreset" />
        </div>
        <v-btn block color="primary" variant="flat" prepend-icon="mdi-auto-fix" :loading="generatingPlan" :disabled="generatingPlan || !sourceCues.length" @click="generatePlan">生成整理方案</v-btn>
        <p v-if="planMessage" class="calibration-status">{{ planMessage }}</p>
        <v-btn block variant="text" prepend-icon="mdi-refresh" class="mt-1" @click="resetPlan">还原原始顺序</v-btn>
        <section class="export-settings">
          <h2>成片设置</h2>
          <v-btn-toggle v-model="outputRatio" mandatory color="primary" density="compact" class="ratio-toggle" @update:model-value="finalRendered = false; finalFileName = ''">
            <v-btn value="source">原比例</v-btn>
            <v-btn value="9:16">竖屏 9:16</v-btn>
          </v-btn-toggle>
          <v-btn block :color="burnSubtitles ? 'primary' : undefined" :variant="burnSubtitles ? 'flat' : 'outlined'" prepend-icon="mdi-subtitles-outline" class="mt-2" @click="burnSubtitles = !burnSubtitles; finalRendered = false; finalFileName = ''">烧录字幕{{ burnSubtitles ? ' · 已启用' : ' · 未启用' }}</v-btn>
          <v-select v-model="subtitleStyle.fontFamily" :items="subtitleFonts" label="字幕字体" density="compact" variant="outlined" hide-details class="mt-2" @update:model-value="saveSubtitleStyle"><template #item="{ props, item }"><v-list-item v-bind="props" @contextmenu.prevent="toggleFontFavorite(String(item.value))"><template #append><v-icon v-if="fontFavorites.includes(String(item.value))" size="15" color="primary">mdi-pin</v-icon></template></v-list-item></template></v-select>
          <div class="font-scale"><span>字幕大小</span><v-slider :model-value="subtitleStyle.fontScale" :min="0.7" :max="1.5" :step="0.1" :ticks="{ 1: '' }" show-ticks="always" hide-details @update:model-value="updateSubtitleScale" @end="saveSubtitleStyle" /></div>
          <div class="position-slider"><span>靠上</span><v-slider :model-value="subtitleStyle.verticalPosition" :min="8" :max="92" :step="1" :ticks="{ 76: '' }" show-ticks="always" hide-details @update:model-value="updateSubtitlePosition" @end="saveSubtitleStyle" /><span>靠下</span></div>
          <div class="style-actions"><v-btn :color="subtitleStyle.bold ? 'primary' : undefined" :variant="subtitleStyle.bold ? 'flat' : 'outlined'" size="small" @click="subtitleStyle.bold = !subtitleStyle.bold; saveSubtitleStyle()"><strong>B</strong> 加粗</v-btn><v-btn :color="subtitleStyle.outline ? 'primary' : undefined" :variant="subtitleStyle.outline ? 'flat' : 'outlined'" size="small" prepend-icon="mdi-format-color-text" @click="subtitleStyle.outline = !subtitleStyle.outline; saveSubtitleStyle()">描边</v-btn></div>
          <div class="color-swatches"><label><span>字色</span><input v-model="subtitleStyle.fontColor" type="color" aria-label="字幕颜色" @input="markFinalStale" @change="saveSubtitleStyle" /></label><label><span>描边</span><input v-model="subtitleStyle.outlineColor" type="color" aria-label="描边颜色" @input="markFinalStale" @change="saveSubtitleStyle" /></label></div>
          <section class="music-settings"><h2>背景音乐</h2><template v-if="backgroundMusic"><div class="music-file"><span>{{ backgroundMusic.fileName }}</span><v-btn icon="mdi-close" size="x-small" variant="text" title="移除背景音乐" @click="removeBackgroundMusic" /></div><audio controls :src="backgroundMusicUrl" :volume="backgroundMusicVolume / 100" /><div class="music-volume"><span>音乐音量</span><v-slider v-model="backgroundMusicVolume" :min="0" :max="30" :step="1" thumb-label hide-details @update:model-value="markFinalStale" @end="saveBackgroundMusic" /></div><v-btn block size="small" variant="text" prepend-icon="mdi-swap-horizontal" @click="chooseBackgroundMusic">更换音乐</v-btn></template><v-btn v-else block variant="outlined" color="primary" prepend-icon="mdi-music-note-plus" @click="chooseBackgroundMusic">导入背景音乐</v-btn></section>
          <section class="highlight-settings"><h2>重点大字 <small>{{ subtitleStyle.highlightScale.toFixed(2) }}</small></h2><div class="font-scale"><span>大字大小</span><v-slider v-model="subtitleStyle.highlightScale" :min="0.7" :max="1.3" :step="0.05" :ticks="{ 1: '' }" show-ticks="always" hide-details @update:model-value="markFinalStale" @end="saveSubtitleStyle" /></div><v-btn block color="primary" variant="flat" prepend-icon="mdi-auto-fix" :loading="generatingHighlights" :disabled="generatingHighlights || !activeCues.length" @click="generateHighlights">{{ highlightItems.length ? '重新挑选重点词' : 'AI 挑重点词' }}</v-btn><v-btn v-if="highlightSuggestions.length" block variant="text" color="primary" prepend-icon="mdi-check-all" class="mt-1" @click="applyAllHighlights">应用全部建议</v-btn><p v-if="highlightMessage" class="calibration-status">{{ highlightMessage }}</p><div class="highlight-template-list"><span v-for="template in highlightTemplates" :key="template.id" :style="{ color: template.color, background: template.background }">{{ template.label }}</span></div></section>
          <section class="sound-settings"><h2>重点词音效</h2><v-btn block :color="soundEffectsEnabled ? 'primary' : undefined" :variant="soundEffectsEnabled ? 'flat' : 'outlined'" prepend-icon="mdi-volume-high" @click="toggleSoundEffects">重点词音效{{ soundEffectsEnabled ? ' · 已启用' : ' · 已关闭' }}</v-btn><div class="sound-previews"><v-btn v-for="effect in soundEffects" :key="effect.style" size="x-small" variant="text" @click="previewSoundEffect(effect.fileName)">{{ effect.label }}</v-btn></div></section>
          <div class="export-status">预计时长 <strong>{{ estimatedDuration }}</strong></div>
          <v-btn block color="primary" variant="flat" prepend-icon="mdi-movie-open" :loading="composing" :disabled="composing || !activeCues.length" @click="generateFinal">{{ finalRendered ? '重新生成成片' : '生成成片' }}</v-btn>
          <p v-if="composeMessage" class="calibration-status">{{ composeMessage }}</p><v-btn v-if="finalRendered" block size="small" variant="text" prepend-icon="mdi-folder-open-outline" @click="openOutputFolder">打开成片文件夹</v-btn>
        </section>
      </aside>
    </section>

    <v-dialog v-model="settingsOpen" max-width="560">
      <v-card prepend-icon="mdi-cog-outline" title="设置">
        <v-card-text class="settings-content">
          <v-select v-model="textModel" :items="textModels" label="文本模型" hide-details />
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
        <v-card-actions><v-spacer /><v-btn variant="text" @click="settingsOpen = false">关闭</v-btn><v-btn :loading="testingApiKey" variant="tonal" @click="testApiKey">测试连接</v-btn><v-btn color="primary" @click="saveSettings">保存</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="replaceSourceOpen" max-width="420">
      <v-card title="更换原视频">
        <v-card-text>更换后会清空当前识别字幕、人工确认稿和后续剪辑计划，且无法自动恢复。</v-card-text>
        <v-card-actions><v-spacer /><v-btn variant="text" @click="replaceSourceOpen = false">取消</v-btn><v-btn color="error" @click="replaceSource">确认更换</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="renameProjectOpen" max-width="420">
      <v-card title="重命名项目">
        <v-card-text><v-text-field v-model="renameProjectName" label="项目名称" autofocus maxlength="80" @keyup.enter="renameProject" /><p v-if="renameProjectMessage" class="calibration-status">{{ renameProjectMessage }}</p></v-card-text>
        <v-card-actions><v-spacer /><v-btn variant="text" @click="renameProjectOpen = false">取消</v-btn><v-btn color="primary" @click="renameProject">确认重命名</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="addHighlightOpen" max-width="520">
      <v-card title="添加花字">
        <v-card-text><v-btn-toggle v-model="addingHighlightMode" mandatory color="primary" density="compact" class="mb-4"><v-btn value="source">原字幕摘取</v-btn><v-btn value="custom">自定义花字</v-btn></v-btn-toggle><v-text-field v-model="addingHighlightPhrase" :label="addingHighlightMode === 'source' ? '强调原句' : '自定义花字'" maxlength="24" counter="24" autofocus @keyup.enter="confirmAddHighlight" /></v-card-text>
        <v-card-actions><v-spacer /><v-btn variant="text" @click="addHighlightOpen = false">取消</v-btn><v-btn color="primary" @click="confirmAddHighlight">添加</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { defaultTalkingHeadSubtitleStyle, editTalkingHeadCues, isTalkingHeadEditPlanValid, talkingHeadHighlightPositions, talkingHeadHighlightTemplates, talkingHeadMediaUrl, talkingHeadSoundEffects, type TalkingHeadBackgroundMusic, type TalkingHeadCue, type TalkingHeadHighlight, type TalkingHeadHighlightPosition, type TalkingHeadHighlightStyle } from '@/runtime/talkingHeadProject'

const workspace = ref<'captions' | 'structure'>('captions')
type ProjectHistoryItem = { name: string; rootPath: string }
type PromptPreset = { name: string; prompt: string }
const PROJECT_HISTORY_KEY = 'jc-koubojianji-project-history'
const SEMANTIC_PRESETS_KEY = 'jc-koubojianji-semantic-presets'
const EDITORIAL_PRESETS_KEY = 'jc-koubojianji-editorial-presets'
function storedArray<T>(key: string, valid: (item: unknown) => item is T) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter(valid) : []
  } catch { return [] }
}
const projectHistory = ref(storedArray<ProjectHistoryItem>(PROJECT_HISTORY_KEY, (item): item is ProjectHistoryItem => Boolean(item && typeof item === 'object' && typeof (item as ProjectHistoryItem).name === 'string' && typeof (item as ProjectHistoryItem).rootPath === 'string')))
const projectRoot = ref('')
const renameProjectOpen = ref(false)
const renameProjectName = ref('')
const renameProjectMessage = ref('')
const settingsOpen = ref(false)
const replaceSourceOpen = ref(false)
const apiKey = ref('')
const apiKeySaved = ref(false)
const apiKeyMessage = ref('')
const showApiKey = ref(false)
const testingApiKey = ref(false)
const textModel = ref('gemini-3.6-flash')
const textModels = [
  { title: 'Gemini 3.6 Flash', value: 'gemini-3.6-flash' },
  { title: '豆包', value: 'doubao-seed-evolving' },
]
const installingFunAsr = ref(false)
const checkingFunAsr = ref(false)
const funAsrProgress = ref('')
const funAsrStatus = ref<{ state: 'ready' | 'missing' | 'installing' | 'failed'; message: string } | null>(null)
const subtitleEngineStatus = ref<{ state: 'ready' | 'missing' | 'installing' | 'failed'; message: string } | null>(null)
const ffmpegStatus = ref<{ state: 'ready' | 'failed'; message: string } | null>(null)
const recognizing = ref(false)
const transcriptionMessage = ref('')
const captionMessage = ref('')
const selectedCueId = ref('cue-01')
const draggingCueId = ref('')
const jiucaiheziEditorialPrompt = '你是口播净稿助手。只按原始顺序删除现有字幕片段，绝不重排、改写、合并、拆分、补写或虚构原话。先把连续的细碎字幕合在脑中理解成完整句子和完整观点，再决定保留或删除，绝不能机械地按单条字幕判断。视频常是照着已经整理好的文案读的：只删除读稿时出现的无意义语气词、卡顿、口误、紧邻重复、说颠倒后立刻自我纠正、同一意思反复说和无法推进理解的片段；保留原文案的观点、事实、步骤、依据、转折、情绪强调和完整句意。删除后相邻保留字幕必须能自然连成话，不能留下半句话、指代不明或逻辑断裂。不要为了钩子、完播、节奏、开头或结尾而删除、移动或调整任何内容。没有可靠依据时不制造数据、案例、夸张承诺或绝对化结论。'
const editorialNote = ref(jiucaiheziEditorialPrompt)
const editorialPresetName = ref('')
const storedEditorialPresets = storedArray<PromptPreset>(EDITORIAL_PRESETS_KEY, (item): item is PromptPreset => Boolean(item && typeof item === 'object' && typeof (item as PromptPreset).name === 'string' && typeof (item as PromptPreset).prompt === 'string'))
const editorialPresets = ref(storedEditorialPresets.length ? storedEditorialPresets : [{ name: '韭菜盒子', prompt: jiucaiheziEditorialPrompt }])
const planState = ref<'draft' | 'previewed'>('draft')
const generatingPlan = ref(false)
const planMessage = ref('')
const semanticPrompt = ref('你是口播字幕校准助手。结合完整上下文修正语音识别错误，不改变原意、语气、句子顺序和信息量。必须主动纠正东北话、方言、连读、平翘舌和轻重音造成的谐音、近音错字；当发音像中文、但上下文属于 AI、编程、模型、产品或英文术语时，必须优先还原为英文正式名称，不能按中文近音字保留。例如“克劳德、克劳的、cla ss、cud”应结合上下文识别为 Claude；“杰米尼、吉米尼、哥们女、man”应结合上下文识别为 Gemini。高优先级术语：Claude、Claude Opus、Gemini、OpenAI、ChatGPT、Codex、Cursor、GitHub、Prompt、API、JSON、Markdown、Vue、Electron、FFmpeg、FunASR、Seedance；即使被识别成中文、拼音碎片、英文碎片或谐音，也必须结合上下文优先还原为正式写法。不要为了补全短句而猜测数量或遗漏内容。可修正明显漏字和断句；保留口头禅、重复句、情绪表达及所有原始信息。不删除、不总结、不扩写、不改写为书面语、不调整字幕顺序。每一条字幕必须一一对应原字幕 ID，数量和顺序不得变化。只输出校准后的字幕文本。')
const semanticPresetName = ref('')
const defaultSemanticPresets = [
  {
    name: '韭菜盒子口播',
    prompt: '你是口播字幕校准助手。结合完整上下文，把口播整理成通顺、自然、适合直接上屏的字幕，不改变原意、观点、事实和信息量。必须主动纠正东北话、方言、连读、平翘舌和轻重音造成的谐音、近音错字；不能因为字面看似中文就保留错误识别。当发音像中文、但上下文属于 AI、编程、模型、产品或英文术语时，必须优先还原为英文正式名称，不能按中文近音字保留。例如“克劳德、克劳的、cla ss、cud”应结合上下文识别为 Claude；“杰米尼、吉米尼、哥们女、man”应结合上下文识别为 Gemini。高优先级术语：Claude、Claude Opus、Gemini、OpenAI、ChatGPT、Codex、Cursor、GitHub、Prompt、API、JSON、Markdown、Vue、Electron、FFmpeg、FunASR、Seedance；即使被识别成中文、拼音碎片、英文碎片或谐音，也必须结合上下文优先还原为正式写法。遇到已整理好的读稿内容，优先还原其完整、准确的原句。不要为了补全短句而猜测数量或遗漏内容。允许删除无意义语气词、卡顿、口误、紧邻重复和明显说颠倒后立刻自我纠正的内容；保留有实际语义、情绪或强调作用的口头表达。可补正明显漏字和断句，但不总结、不扩写、不凭空补内容、不调整字幕顺序。每一条字幕必须一一对应原字幕 ID，数量和顺序不得变化；不得合并或拆分字幕。只输出校准后的字幕文本。',
  },
]
const storedSemanticPresets = storedArray<PromptPreset>(SEMANTIC_PRESETS_KEY, (item): item is PromptPreset => Boolean(item && typeof item === 'object' && typeof (item as PromptPreset).name === 'string' && typeof (item as PromptPreset).prompt === 'string'))
const semanticPresets = ref(storedSemanticPresets.length ? storedSemanticPresets : defaultSemanticPresets)
const semanticSuggestionsVisible = ref(false)
const semanticSuggestions = ref<Array<{ cueId: string; text: string }>>([])
const semanticApplied = ref(false)
const calibrating = ref(false)
const calibrationMessage = ref('')
const finalRendered = ref(false)
const composing = ref(false)
const composeMessage = ref('')
const finalFileName = ref('')
const finalVersion = ref('')
const outputRatio = ref<import('@/runtime/talkingHeadProject').TalkingHeadOutputRatio>('source')
const burnSubtitles = ref(true)
const subtitleFonts = ref<string[]>([defaultTalkingHeadSubtitleStyle.fontFamily])
const FONT_FAVORITES_KEY = 'jc-koubojianji-font-favorites'
function storedFontFavorites() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FONT_FAVORITES_KEY) || '[]')
    return Array.isArray(value) ? value.filter((font): font is string => typeof font === 'string') : []
  } catch {
    return []
  }
}
const fontFavorites = ref<string[]>(storedFontFavorites())
const subtitleStyle = ref({ ...defaultTalkingHeadSubtitleStyle })
const backgroundMusic = ref<TalkingHeadBackgroundMusic | undefined>()
const backgroundMusicVolume = ref(10)
const highlightTemplates = talkingHeadHighlightTemplates
const highlightPositions = talkingHeadHighlightPositions
const soundEffects = talkingHeadSoundEffects
const soundEffectsEnabled = ref(true)
const highlightItems = ref<TalkingHeadHighlight[]>([])
const highlightSuggestions = ref<TalkingHeadHighlight[]>([])
const generatingHighlights = ref(false)
const highlightMessage = ref('')
const addHighlightOpen = ref(false)
const addingHighlightCue = ref<TalkingHeadCue | null>(null)
const addingHighlightPhrase = ref('')
const addingHighlightMode = ref<'source' | 'custom'>('source')
const addingHighlightOriginal = ref<TalkingHeadHighlight | null>(null)
const selectedPreviewHighlight = ref<TalkingHeadHighlight | null>(null)
const selectedPreviewCueId = ref('')
const sourceCues = ref<TalkingHeadCue[]>([])
const sourceFileName = ref('')
const sourceFingerprint = ref('')
const sourceVideo = ref<HTMLVideoElement | null>(null)
const structureVideo = ref<HTMLVideoElement | null>(null)
const sourceAspect = ref(16 / 9)
const cuePreviewEndMs = ref<number | null>(null)
const captionPlayheadMs = ref(0)
const planCues = ref<Array<TalkingHeadCue & { removed: boolean }>>([])
const activeCues = computed(() => planCues.value.filter((cue) => !cue.removed))
const removedCues = computed(() => planCues.value.filter((cue) => cue.removed))
const estimatedDuration = computed(() => {
  const milliseconds = activeCues.value.reduce((total, cue) => total + cue.endMs - cue.startMs, 0)
  return `00:${String(Math.round(milliseconds / 1000)).padStart(2, '0')}`
})
const apiKeyStatus = computed(() => apiKeyMessage.value || (apiKeySaved.value ? 'API Key 已保存。' : '尚未配置 API Key。'))
const sourceVideoUrl = computed(() => sourceFileName.value && projectRoot.value ? `${talkingHeadMediaUrl(projectRoot.value, sourceFileName.value)}&v=${encodeURIComponent(sourceFingerprint.value)}` : '')
const finalVideoUrl = computed(() => finalFileName.value && projectRoot.value ? `${talkingHeadMediaUrl(projectRoot.value, finalFileName.value)}&v=${encodeURIComponent(finalVersion.value)}` : '')
const backgroundMusicUrl = computed(() => backgroundMusic.value && projectRoot.value ? talkingHeadMediaUrl(projectRoot.value, backgroundMusic.value.fileName, '音频') : '')
const previewOutputFrameStyle = computed(() => {
  const aspect = outputRatio.value === '9:16' ? 9 / 16 : sourceAspect.value
  return aspect >= 9 / 16 ? { width: '100%', height: `${(9 / 16) / aspect * 100}%` } : { width: `${aspect / (9 / 16) * 100}%`, height: '100%' }
})
const subtitlePreviewStyle = computed(() => ({ fontFamily: subtitleStyle.value.fontFamily, fontSize: `${Math.round(22 * subtitleStyle.value.fontScale)}px`, fontWeight: subtitleStyle.value.bold ? '700' : '400', color: subtitleStyle.value.fontColor, WebkitTextStroke: subtitleStyle.value.outline ? `${22 * subtitleStyle.value.fontScale * .02}px ${subtitleStyle.value.outlineColor}` : undefined, top: `${subtitleStyle.value.verticalPosition}%`, transform: 'translateY(-100%)' }))
const previewHighlight = computed(() => selectedPreviewHighlight.value || highlightItems.value[0] || highlightSuggestions.value[0])
const previewCue = computed(() => sourceCues.value.find((cue) => cue.cueId === selectedPreviewCueId.value || cue.cueId === previewHighlight.value?.cueId))

onMounted(async () => {
  subtitleFonts.value = sortFonts(await window.electron.talkingHeadProject.listFonts())
  apiKeySaved.value = await window.electron.cloud.hasApiKey()
  funAsrStatus.value = await window.electron.cloud.funAsrInstallStatus()
  subtitleEngineStatus.value = await window.electron.cloud.funAsrSubtitleInstallStatus()
  ffmpegStatus.value = await window.electron.cloud.ffmpegStatus()
})
const stopFunAsrProgress = window.electron.cloud.onFunAsrInstallProgress((message) => {
  funAsrProgress.value = message
})
const stopTranscriptionProgress = window.electron.talkingHeadProject.onProgress((message) => {
  transcriptionMessage.value = message
  if (composing.value) composeMessage.value = message
})
onBeforeUnmount(() => {
  stopFunAsrProgress()
  stopTranscriptionProgress()
})

function formatTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
function formatPreciseTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${String(Math.max(0, Math.round(milliseconds % 1000))).padStart(3, '0')}`
}
function syncCaptionPlayhead(event: Event) {
  const video = event.target
  if (!(video instanceof HTMLVideoElement)) return
  captionPlayheadMs.value = Math.round(video.currentTime * 1000)
  stopCuePreview(event)
}
function selectCue(cue: TalkingHeadCue) {
  selectedCueId.value = cue.cueId
  const video = sourceVideo.value
  if (!video) return
  cuePreviewEndMs.value = cue.endMs + 300
  video.currentTime = Math.max(0, (cue.startMs - 200) / 1000)
  void video.play().catch(() => undefined)
}
function stopCuePreview(event?: Event) {
  const video = event?.target instanceof HTMLVideoElement ? event.target : sourceVideo.value
  if (!video || cuePreviewEndMs.value === null || video.currentTime * 1000 < cuePreviewEndMs.value) return
  video.pause()
  cuePreviewEndMs.value = null
}
function rememberProject(project: ProjectHistoryItem) {
  projectHistory.value = [project, ...projectHistory.value.filter((item) => item.rootPath !== project.rootPath)].slice(0, 20)
  localStorage.setItem(PROJECT_HISTORY_KEY, JSON.stringify(projectHistory.value))
}
async function switchProject(value: unknown) {
  if (typeof value !== 'string' || !value) return
  projectRoot.value = value
  captionMessage.value = ''
  try {
    await loadProjectState()
  } catch (error) {
    captionMessage.value = `项目打开失败：${error instanceof Error ? error.message : String(error)}`
  }
}
async function chooseProject() {
  const project = await window.electron?.talkingHeadProject?.choose()
  if (!project) return
  projectRoot.value = project.rootPath
  rememberProject(project)
  await loadProjectState()
}
async function loadProjectState() {
  if (!projectRoot.value) return
  const state = await window.electron.talkingHeadProject.load(projectRoot.value)
  sourceCues.value = state.cues
  sourceFileName.value = state.source?.fileName || ''
  sourceFingerprint.value = state.source?.fingerprint || ''
  subtitleStyle.value = { ...defaultTalkingHeadSubtitleStyle, ...state.subtitleStyle }
  backgroundMusic.value = state.backgroundMusic
  soundEffectsEnabled.value = state.soundEffectsEnabled !== false
  backgroundMusicVolume.value = Math.round((state.backgroundMusic?.volume ?? .10) * 100)
  finalRendered.value = false
  finalFileName.value = ''
  highlightItems.value = state.highlightPlan?.sourceFingerprint === state.source?.fingerprint
    ? (state.highlightPlan?.items || []).map((item) => ({ ...item, style: item.style === '爆点黄' ? '爆点黄' : '结论绿' as TalkingHeadHighlightStyle }))
    : []
  highlightSuggestions.value = []
  await window.electron.talkingHeadProject.prepareSoundEffects(projectRoot.value)
  const plan = !state.editPlanStale && isTalkingHeadEditPlanValid(state.editPlan, state.cues, state.source?.fingerprint) ? state.editPlan : undefined
  const byId = new Map(state.cues.map((cue) => [cue.cueId, cue]))
  planCues.value = (plan?.cueIds || state.cues.map((cue) => cue.cueId)).map((cueId) => ({ ...byId.get(cueId)!, removed: Boolean(plan?.removedCueIds.includes(cueId)) }))
}
async function chooseSource() {
  const source = await window.electron.talkingHeadProject.chooseSource(projectRoot.value || undefined)
  if (source) {
    projectRoot.value = source.rootPath
    rememberProject({ name: source.name, rootPath: source.rootPath })
    sourceCues.value = []
    sourceFileName.value = source.fileName
    sourceFingerprint.value = source.fingerprint
  }
}
function openRenameProject() {
  const project = projectHistory.value.find((item) => item.rootPath === projectRoot.value)
  renameProjectName.value = project?.name || projectRoot.value.split(/[\\/]/).at(-1) || ''
  renameProjectMessage.value = ''
  renameProjectOpen.value = true
}
async function renameProject() {
  if (!projectRoot.value || !renameProjectName.value.trim()) return
  renameProjectMessage.value = ''
  try {
    const previousRoot = projectRoot.value
    const project = await window.electron.talkingHeadProject.rename(previousRoot, renameProjectName.value)
    projectHistory.value = projectHistory.value.filter((item) => item.rootPath !== previousRoot)
    projectRoot.value = project.rootPath
    rememberProject(project)
    renameProjectOpen.value = false
    await loadProjectState()
  } catch (error) {
    renameProjectMessage.value = error instanceof Error ? error.message : String(error)
  }
}
function confirmReplaceSource() {
  replaceSourceOpen.value = true
}
async function replaceSource() {
  replaceSourceOpen.value = false
  await chooseSource()
}
async function transcribe() {
  if (!projectRoot.value) return
  subtitleEngineStatus.value = await window.electron.cloud.funAsrSubtitleInstallStatus()
  if (subtitleEngineStatus.value.state !== 'ready') {
    transcriptionMessage.value = '本地字幕引擎未就绪，请在设置中完成一键安装。'
    settingsOpen.value = true
    return
  }
  recognizing.value = true
  transcriptionMessage.value = '正在准备识别字幕…'
  try {
    const result = await window.electron.talkingHeadProject.transcribe(projectRoot.value)
    sourceCues.value = result.cues
    transcriptionMessage.value = `字幕识别完成，共 ${result.cues.length} 条`
  } catch (error) {
    transcriptionMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    recognizing.value = false
  }
}
async function saveCues() {
  if (!projectRoot.value || !sourceCues.value.length) return
  const result = await window.electron.talkingHeadProject.saveCues(projectRoot.value, JSON.parse(JSON.stringify(sourceCues.value)))
  sourceCues.value = result.cues
}
async function editCue(action: 'add' | 'split' | 'merge-next' | 'set-start' | 'set-end' | 'delete') {
  const next = editTalkingHeadCues(sourceCues.value, selectedCueId.value, action, captionPlayheadMs.value)
  sourceCues.value = next
  selectedCueId.value = next[0]?.cueId || ''
  await saveCues()
}
async function confirmCaptions() {
  await enterStructureWorkspace()
}
async function enterStructureWorkspace() {
  captionMessage.value = ''
  if (!sourceCues.value.length) {
    captionMessage.value = '请先识别出至少一条字幕。'
    return
  }
  try {
    await saveCues()
    await loadProjectState()
    workspace.value = 'structure'
    void previewPlanCue(activeCues.value[0])
  } catch (error) {
    captionMessage.value = `字幕保存失败：${error instanceof Error ? error.message : String(error)}`
  }
}
async function showProject() {
  if (projectRoot.value) await window.electron?.talkingHeadProject?.show(projectRoot.value)
}
async function openSettings() {
  settingsOpen.value = true
  apiKeySaved.value = await window.electron.cloud.hasApiKey()
}
async function checkFunAsr() {
  checkingFunAsr.value = true
  funAsrProgress.value = '正在搜索、验证并绑定本机已有引擎…'
  try {
    const [funAsr, ffmpeg] = await Promise.all([
      window.electron.cloud.scanFunAsr(),
      window.electron.cloud.ffmpegStatus(),
    ])
    funAsrStatus.value = funAsr
    subtitleEngineStatus.value = await window.electron.cloud.funAsrSubtitleInstallStatus()
    ffmpegStatus.value = ffmpeg
  } catch (error) {
    funAsrStatus.value = { state: 'failed', message: `扫描失败：${error instanceof Error ? error.message : String(error)}` }
  } finally {
    checkingFunAsr.value = false
    funAsrProgress.value = ''
  }
}
async function saveSettings() {
  if (apiKey.value.trim()) await window.electron.cloud.saveApiKey(apiKey.value)
  apiKeySaved.value = await window.electron.cloud.hasApiKey()
  apiKeyMessage.value = ''
  apiKey.value = ''
  settingsOpen.value = false
}
async function testApiKey() {
  testingApiKey.value = true
  apiKeyMessage.value = '正在连接云端…'
  try {
    if (apiKey.value.trim()) await window.electron.cloud.saveApiKey(apiKey.value)
    await window.electron.cloud.testApiKey(textModel.value as import('~/electron/types').TextModel)
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
    subtitleEngineStatus.value = await window.electron.cloud.funAsrSubtitleInstallStatus()
  } finally {
    installingFunAsr.value = false
    funAsrProgress.value = ''
  }
}
function openKeysPage() {
  window.electron.openExternal({ url: 'https://api.jiucaihezi.studio/keys' })
}
function markFinalStale() {
  finalRendered.value = false
  finalFileName.value = ''
}
async function saveSubtitleStyle() {
  markFinalStale()
  if (!projectRoot.value) return
  try {
    const result = await window.electron.talkingHeadProject.saveSubtitleStyle(projectRoot.value, { ...subtitleStyle.value })
    subtitleStyle.value = result.subtitleStyle
  } catch (error) {
    composeMessage.value = `字幕样式保存失败：${error instanceof Error ? error.message : String(error)}`
  }
}
async function chooseBackgroundMusic() {
  if (!projectRoot.value) return
  const music = await window.electron.talkingHeadProject.chooseBackgroundMusic(projectRoot.value)
  if (!music) return
  backgroundMusic.value = music
  backgroundMusicVolume.value = Math.round(music.volume * 100)
  markFinalStale()
}
async function saveBackgroundMusic() {
  if (!projectRoot.value || !backgroundMusic.value) return
  const result = await window.electron.talkingHeadProject.saveBackgroundMusic(projectRoot.value, { ...backgroundMusic.value, volume: backgroundMusicVolume.value / 100 })
  backgroundMusic.value = result.backgroundMusic
}
async function removeBackgroundMusic() {
  if (!projectRoot.value) return
  await window.electron.talkingHeadProject.saveBackgroundMusic(projectRoot.value)
  backgroundMusic.value = undefined
  markFinalStale()
}
async function toggleSoundEffects() {
  if (!projectRoot.value) return
  soundEffectsEnabled.value = await window.electron.talkingHeadProject.setSoundEffectsEnabled(projectRoot.value, !soundEffectsEnabled.value)
  markFinalStale()
}
async function previewSoundEffect(fileName: string) {
  if (!projectRoot.value) return
  await window.electron.talkingHeadProject.prepareSoundEffects(projectRoot.value)
  await new Audio(talkingHeadMediaUrl(projectRoot.value, fileName, '音频')).play().catch(() => undefined)
}
function sortFonts(fonts: string[]) {
  return [...fonts].sort((left, right) => {
    const leftIndex = fontFavorites.value.indexOf(left)
    const rightIndex = fontFavorites.value.indexOf(right)
    if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? Infinity : leftIndex) - (rightIndex < 0 ? Infinity : rightIndex)
    return left.localeCompare(right, 'zh-Hans-CN')
  })
}
function toggleFontFavorite(font: string) {
  const index = fontFavorites.value.indexOf(font)
  if (index >= 0) fontFavorites.value.splice(index, 1)
  else fontFavorites.value.unshift(font)
  localStorage.setItem(FONT_FAVORITES_KEY, JSON.stringify(fontFavorites.value))
  subtitleFonts.value = sortFonts(subtitleFonts.value)
}
function updateSubtitlePosition(value: number) {
  subtitleStyle.value.verticalPosition = Math.abs(value - 76) <= 2 ? 76 : value
  markFinalStale()
}
function readSourceAspect() { if (structureVideo.value?.videoWidth && structureVideo.value?.videoHeight) sourceAspect.value = structureVideo.value.videoWidth / structureVideo.value.videoHeight }
function updateSubtitleScale(value: number) {
  subtitleStyle.value.fontScale = Math.abs(value - 1) < .05 ? 1 : value
  markFinalStale()
}
function highlightForCue(cueId: string) {
  return highlightItems.value.find((item) => item.cueId === cueId)
}
function highlightSuggestionForCue(cueId: string) {
  return highlightSuggestions.value.find((item) => item.cueId === cueId)
}
function highlightPreviewStyle(item: TalkingHeadHighlight) {
  const template = highlightTemplates.find((candidate) => candidate.id === item.style)
  return template ? { color: template.color, background: template.background, fontWeight: '800', fontSize: `${template.scale * 1.7 * subtitleStyle.value.highlightScale}em` } : {}
}
function highlightChipStyle(item: TalkingHeadHighlight) {
  const template = highlightTemplates.find((candidate) => candidate.id === item.style)
  return template ? { color: template.color, background: template.background, fontWeight: '700', fontSize: '14px' } : {}
}
async function previewHighlightItem(item: TalkingHeadHighlight) {
  selectedPreviewHighlight.value = item
  selectedPreviewCueId.value = item.cueId
  await previewPlanCue(sourceCues.value.find((candidate) => candidate.cueId === item.cueId))
}
async function previewPlanCue(cue?: TalkingHeadCue) {
  if (!cue) return
  selectedPreviewCueId.value = cue.cueId
  selectedPreviewHighlight.value = highlightForCue(cue.cueId) || highlightSuggestionForCue(cue.cueId) || null
  await nextTick()
  const video = structureVideo.value
  if (!video) return
  cuePreviewEndMs.value = cue.endMs
  video.currentTime = cue.startMs / 1000
  await video.play().catch(() => undefined)
}
async function commitHighlights(items: TalkingHeadHighlight[]) {
  if (!projectRoot.value || !sourceFingerprint.value) return false
  try {
    const result = await window.electron.talkingHeadProject.saveHighlights(projectRoot.value, { sourceFingerprint: sourceFingerprint.value, items: items.map((item) => ({ ...item })), updatedAt: new Date().toISOString() })
    highlightItems.value = result.plan.items
    markFinalStale()
    return true
  } catch (error) {
    highlightMessage.value = `花字保存失败：${error instanceof Error ? error.message : String(error)}`
    return false
  }
}
async function generateHighlights() {
  if (!projectRoot.value) return
  generatingHighlights.value = true
  highlightMessage.value = '正在从整理后的口播中挑选花字…'
  try {
    const result = await window.electron.talkingHeadProject.generateHighlights(projectRoot.value, textModel.value as import('~/electron/types').TextModel)
    highlightSuggestions.value = result.items
    selectedPreviewHighlight.value = highlightSuggestions.value[0] || null
    highlightMessage.value = highlightSuggestions.value.length ? `已重新挑选 ${highlightSuggestions.value.length} 个重点词，请确认后应用。` : '没有找到适合强调的词。'
  } catch (error) {
    highlightMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    generatingHighlights.value = false
  }
}
async function applyHighlight(item: TalkingHeadHighlight) {
  const next = [...highlightItems.value.filter((candidate) => candidate.cueId !== item.cueId), item]
  if (!(await commitHighlights(next))) return
  highlightSuggestions.value = highlightSuggestions.value.filter((candidate) => candidate.cueId !== item.cueId)
  selectedPreviewHighlight.value = highlightForCue(item.cueId) || null
}
async function applyAllHighlights() {
  const replacements = new Map(highlightSuggestions.value.map((item) => [item.cueId, item]))
  const next = [...highlightItems.value.filter((item) => !replacements.has(item.cueId)), ...highlightSuggestions.value]
  if (!(await commitHighlights(next))) return
  highlightSuggestions.value = []
  selectedPreviewHighlight.value = highlightItems.value[0] || null
  highlightMessage.value = `已应用 ${highlightItems.value.length} 个花字。`
}
function openAddHighlight(cue: TalkingHeadCue, item?: TalkingHeadHighlight) {
  addingHighlightCue.value = cue
  addingHighlightOriginal.value = item || null
  addingHighlightPhrase.value = item?.phrase || cue.confirmedText
  addingHighlightMode.value = item?.custom ? 'custom' : 'source'
  addHighlightOpen.value = true
}
async function confirmAddHighlight() {
  const cue = addingHighlightCue.value
  const phrase = addingHighlightPhrase.value.trim()
  if (!cue || !phrase) {
    highlightMessage.value = '请输入花字文字。'
    return
  }
  if ([...phrase].length > 24) {
    highlightMessage.value = '花字最多 24 个字。'
    return
  }
  if (addingHighlightMode.value === 'source' && !cue.confirmedText.includes(phrase)) {
    highlightMessage.value = '花字必须是当前字幕中的原句文字。'
    return
  }
  const item: TalkingHeadHighlight = { cueId: cue.cueId, phrase, custom: addingHighlightMode.value === 'custom', style: addingHighlightOriginal.value?.style || '爆点黄', position: addingHighlightOriginal.value?.position || '左上' }
  const next = [...highlightItems.value.filter((candidate) => candidate.cueId !== cue.cueId), item]
  if (!(await commitHighlights(next))) return
  highlightSuggestions.value = highlightSuggestions.value.filter((candidate) => candidate.cueId !== cue.cueId)
  selectedPreviewHighlight.value = highlightForCue(cue.cueId) || null
  addHighlightOpen.value = false
}
async function removeHighlight(cueId: string) {
  if (!(await commitHighlights(highlightItems.value.filter((item) => item.cueId !== cueId)))) return
  if (selectedPreviewHighlight.value?.cueId === cueId) selectedPreviewHighlight.value = highlightItems.value[0] || null
}
async function changeHighlightStyle(cueId: string, style: string) {
  if (!highlightTemplates.some((template) => template.id === style)) return
  if (!(await commitHighlights(highlightItems.value.map((item) => item.cueId === cueId ? { ...item, style: style as TalkingHeadHighlightStyle } : item)))) return
  selectedPreviewHighlight.value = highlightForCue(cueId) || null
}
async function changeHighlightPosition(cueId: string, position: TalkingHeadHighlightPosition) {
  if (!(await commitHighlights(highlightItems.value.map((item) => item.cueId === cueId ? { ...item, position } : item)))) return
  selectedPreviewHighlight.value = highlightForCue(cueId) || null
}
function move(cueId: string, direction: -1 | 1) {
  const next = planCues.value.slice()
  const from = next.findIndex((cue) => cue.cueId === cueId)
  const to = from + direction
  if (from < 0 || to < 0 || to >= next.length) return
  ;[next[from], next[to]] = [next[to], next[from]]
  planCues.value = next
  planState.value = 'draft'
  finalRendered.value = false
  finalFileName.value = ''
  void savePlan()
}
function toggle(cueId: string) {
  planCues.value = planCues.value.map((cue) => cue.cueId === cueId ? { ...cue, removed: !cue.removed } : cue)
  planState.value = 'draft'
  finalRendered.value = false
  finalFileName.value = ''
  void savePlan()
}
function dropCue(targetCueId: string) {
  const from = planCues.value.findIndex((cue) => cue.cueId === draggingCueId.value)
  const to = planCues.value.findIndex((cue) => cue.cueId === targetCueId)
  if (from < 0 || to < 0 || from === to) return
  const next = planCues.value.slice()
  const [cue] = next.splice(from, 1)
  next.splice(to, 0, cue)
  planCues.value = next
  planState.value = 'draft'
  finalRendered.value = false
  finalFileName.value = ''
  void savePlan()
}
function selectEditorialPreset(prompt: string) {
  editorialNote.value = prompt
}
function saveEditorialPreset() {
  const name = editorialPresetName.value.trim()
  const prompt = editorialNote.value.trim()
  if (!name || !prompt) return
  const existing = editorialPresets.value.findIndex((preset) => preset.name === name)
  const next = { name, prompt }
  if (existing >= 0) editorialPresets.value.splice(existing, 1, next)
  else editorialPresets.value.push(next)
  localStorage.setItem(EDITORIAL_PRESETS_KEY, JSON.stringify(editorialPresets.value))
  editorialPresetName.value = ''
}
async function savePlan() {
  if (!projectRoot.value || !sourceFingerprint.value || !planCues.value.length) return
  await window.electron.talkingHeadProject.saveEditPlan(projectRoot.value, {
    sourceFingerprint: sourceFingerprint.value,
    cueIds: [...planCues.value.map((cue) => cue.cueId)],
    removedCueIds: [...planCues.value.filter((cue) => cue.removed).map((cue) => cue.cueId)],
    updatedAt: new Date().toISOString(),
  })
}
async function generatePlan() {
  if (!projectRoot.value || !editorialNote.value.trim()) return
  generatingPlan.value = true
  planMessage.value = '正在生成结构整理方案…'
  try {
    const result = await window.electron.talkingHeadProject.generateEditPlan(projectRoot.value, textModel.value as import('~/electron/types').TextModel, editorialNote.value)
    const byId = new Map(sourceCues.value.map((cue) => [cue.cueId, cue]))
    planCues.value = result.plan.cueIds.map((cueId) => ({ ...byId.get(cueId)!, removed: result.plan.removedCueIds.includes(cueId) }))
    planState.value = 'draft'
    finalRendered.value = false
    finalFileName.value = ''
    planMessage.value = `方案已生成：保留 ${planCues.value.filter((cue) => !cue.removed).length} 段，删除 ${result.plan.removedCueIds.length} 段。`
  } catch (error) {
    planMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    generatingPlan.value = false
  }
}
function resetPlan() {
  planCues.value = sourceCues.value.map((cue) => ({ ...cue, removed: false }))
  planState.value = 'draft'
  finalRendered.value = false
  finalFileName.value = ''
  void savePlan()
}
function saveSemanticPreset() {
  const name = semanticPresetName.value.trim()
  const prompt = semanticPrompt.value.trim()
  if (!name || !prompt) return
  const existing = semanticPresets.value.findIndex((preset) => preset.name === name)
  const next = { name, prompt }
  if (existing >= 0) semanticPresets.value.splice(existing, 1, next)
  else semanticPresets.value.push(next)
  localStorage.setItem(SEMANTIC_PRESETS_KEY, JSON.stringify(semanticPresets.value))
  semanticPresetName.value = ''
}
function semanticSuggestion(cueId: string) {
  return semanticSuggestions.value.find((suggestion) => suggestion.cueId === cueId)?.text || ''
}
async function startSemanticCalibration() {
  if (!projectRoot.value) return
  calibrating.value = true
  calibrationMessage.value = '正在根据完整上下文生成校准建议…'
  try {
    const result = await window.electron.talkingHeadProject.calibrate(projectRoot.value, textModel.value as import('~/electron/types').TextModel, semanticPrompt.value)
    semanticSuggestions.value = result.suggestions
    semanticApplied.value = false
    semanticSuggestionsVisible.value = true
    calibrationMessage.value = `已生成 ${result.suggestions.length} 条校准建议，请逐条确认。`
  } catch (error) {
    calibrationMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    calibrating.value = false
  }
}
function applySemanticSuggestions() {
  const byId = new Map(semanticSuggestions.value.map((suggestion) => [suggestion.cueId, suggestion.text]))
  sourceCues.value = sourceCues.value.map((cue) => ({ ...cue, confirmedText: byId.get(cue.cueId) || cue.confirmedText }))
  void saveCues()
  semanticSuggestionsVisible.value = false
  semanticApplied.value = true
}
function undoSemanticCalibration() {
  semanticSuggestionsVisible.value = false
  semanticSuggestions.value = []
}
async function restoreRecognized() {
  if (!projectRoot.value) return
  const result = await window.electron.talkingHeadProject.restoreRecognized(projectRoot.value)
  sourceCues.value = result.cues
  semanticApplied.value = false
}
async function generateFinal() {
  if (!projectRoot.value) return
  composing.value = true
  composeMessage.value = '正在保存整理方案…'
  try {
    await savePlan()
    if (!(await commitHighlights(highlightItems.value))) throw new Error(highlightMessage.value)
    const result = await window.electron.talkingHeadProject.compose(projectRoot.value, { ratio: outputRatio.value, burnSubtitles: burnSubtitles.value, subtitleStyle: { ...subtitleStyle.value } })
    finalFileName.value = result.fileName
    finalVersion.value = String(Date.now())
    finalRendered.value = true
    planState.value = 'previewed'
    composeMessage.value = '成片已生成，已保存到项目视频文件夹。'
  } catch (error) {
    composeMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    composing.value = false
  }
}
async function openOutputFolder() {
  if (projectRoot.value) await window.electron.talkingHeadProject.showOutput(projectRoot.value)
}
</script>

<style scoped>
.desk-shell { height: 100%; padding-top: 40px; display: grid; grid-template-rows: 52px minmax(0, 1fr); background: #f6f7f5; color: #17211a; }
.project-bar { display: flex; align-items: center; gap: 7px; padding: 0 12px; border-bottom: 1px solid #dfe5df; background: #fff; }.project-select { width: 280px; }.workspace-nav { display: flex; align-items: center; gap: 5px; }.workspace-nav button { height: 34px; padding: 0 12px; display: inline-flex; align-items: center; gap: 7px; border: 0; border-radius: 5px; background: transparent; color: #5d685f; font: inherit; white-space: nowrap; cursor: pointer; }.workspace-nav button.active { background: #e8f5eb; color: #176b37; font-weight: 650; }.workspace-arrow { color: #a8b0a9; }
.caption-workspace { min-height: 0; display: grid; grid-template-columns: minmax(300px, 360px) minmax(520px, 1fr) 300px; gap: 12px; padding: 12px; }.source-preview, .caption-table-wrap, .caption-actions, .final-preview-panel, .plan-panel, .instruction-panel { min-width: 0; border: 1px solid #dfe5df; border-radius: 6px; background: #fff; overflow: auto; }
.source-preview { display: grid; align-content: start; padding: 10px; }.video-stage { width: 100%; aspect-ratio: 9 / 16; display: grid; place-content: center; gap: 8px; background: #1d2420; color: #d8e2da; text-align: center; }.video-meta { display:flex; justify-content:space-between; padding: 11px 2px; color: #68736a; font-size: 12px; }
.panel-heading { min-height: 76px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e6ebe6; }.panel-heading.compact { min-height: 66px; }.panel-heading h1, .caption-actions h2, .export-settings h2 { margin: 0; font-size: 16px; font-weight: 700; }.panel-heading p, .caption-actions p { margin: 4px 0 0; color: #6c766f; font-size: 12px; }
.caption-table { width: 100%; border-collapse: collapse; font-size: 13px; }.caption-table th { padding: 10px 12px; text-align: left; color: #647067; background: #f8faf8; font-size: 12px; font-weight: 600; }.caption-table td { padding: 11px 12px; border-top: 1px solid #edf0ed; vertical-align: top; line-height: 1.55; }.caption-table tr { cursor: pointer; }.caption-table tr.caption-selected { background: #f2faf3; }.caption-table textarea { width: 100%; min-height: 42px; padding: 5px; border: 1px solid #d6ded7; border-radius: 4px; resize: vertical; color: inherit; font: inherit; }
.caption-actions { padding: 0 16px; }.inspector-section { padding: 16px 0; border-bottom: 1px solid #e4e9e4; }.inspector-section h2 { margin-bottom: 10px; font-size: 15px; }.inspector-section p { margin-bottom: 10px; }.engine-status { min-height: 18px; color: #68736a; }.engine-failed { color: #b3261e; }.engine-ready { color: #176b37; }.calibration-status { color: #68736a; line-height: 1.45; }.inspector-confirm { border-bottom: 0; }.semantic-prompt-label { display: block; margin: 12px 0 6px; color: #7a857c; font-size: 12px; }.semantic-prompt { box-sizing: border-box; width: 100%; min-height: 94px; padding: 8px; border: 1px solid #d6ded7; border-radius: 4px; resize: vertical; color: inherit; font: inherit; font-size: 12px; line-height: 1.5; }.semantic-prompt:focus { outline: 2px solid #c6e8cd; border-color: #62a571; }.semantic-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }.semantic-presets span { width: 100%; color: #7a857c; font-size: 12px; }.semantic-presets button { border: 1px solid #dbe5dc; border-radius: 4px; background: #fff; padding: 5px 7px; color: #3d6f49; font: inherit; font-size: 12px; cursor: pointer; }.semantic-presets button.selected { border-color: #3d8b52; background: #edf8ef; }.preset-save { display: flex; align-items: center; gap: 4px; margin-top: 8px; }.preset-save input { min-width: 0; flex: 1; height: 30px; padding: 0 8px; border: 1px solid #d6ded7; border-radius: 4px; color: inherit; font: inherit; font-size: 12px; }.preset-save input:focus { outline: 2px solid #c6e8cd; border-color: #62a571; }
.structure-workspace { min-height: 0; display: grid; grid-template-columns: minmax(300px, 360px) minmax(420px, 1.45fr) minmax(290px, .85fr); gap: 12px; padding: 12px; }.final-preview-panel { padding: 10px; }.final-video-stage { position: relative; width: 100%; aspect-ratio: 9 / 16; align-self: start; display: grid; place-content: center; gap: 8px; overflow: hidden; background: #1d2420; color: #d8e2da; text-align: center; }.preview-video { width: 100%; height: 100%; object-fit: contain; }.preview-output-frame { position: absolute; inset: 0; margin: auto; border: 2px solid #27a653; box-sizing: border-box; pointer-events: none; }.subtitle-style-preview { position: absolute; left: 10%; right: 10%; z-index: 1; color: #fff; line-height: 1.35; pointer-events: none; }.focus-word-preview { position: absolute; top: 22%; left: 10%; z-index: 2; max-width: 78%; padding: 5px 9px; border-radius: 3px; line-height: 1.12; box-shadow: 2px 3px 0 rgba(0,0,0,.5); }.focus-右上 { left: auto; right: 10%; }.focus-左中 { top: 43%; }.focus-右中 { top: 43%; left: auto; right: 10%; }.focus-上中 { top: 16%; left: 50%; transform: translateX(-50%); text-align: center; }.final-video-stage small { color: #b8c6ba; font-size: 12px; }.plan-cue p { margin: 4px 0 0; line-height: 1.55; font-size: 13px; }.highlight-row { align-items: center; min-height: 28px; }.highlight-label { max-width: 168px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.position-choices { display: inline-flex; gap: 3px; }.position-choices button { border: 1px solid #d6ded7; border-radius: 3px; background: #fff; padding: 2px 4px; color: #68736a; font: inherit; font-size: 10px; cursor: pointer; }.position-choices button.active { border-color: #219653; background: #edf8ef; color: #176b37; }.highlight-settings h2 { display: flex; justify-content: space-between; align-items: center; }.highlight-settings h2 small { color: #68736a; font-size: 12px; font-weight: 500; }.font-scale { min-height: 46px; margin-top: 10px; }.position-slider { height: 48px; margin-top: 12px; }
.plan-panel { padding-bottom: 12px; }.plan-section { display: flex; justify-content: space-between; padding: 14px 16px 8px; color: #176b37; font-size: 13px; font-weight: 700; }.plan-section small { color: #89938b; font-size: 11px; font-weight: 400; }.plan-cue { display: flex; align-items: center; gap: 10px; margin: 0 12px 8px; padding: 10px; border: 1px solid #dfe5df; border-radius: 5px; background: #fff; cursor: grab; }.plan-cue:hover { border-color: #86bd91; }.drag-handle { color: #a0aaa2; }.plan-cue-body { flex: 1; min-width: 0; }.plan-cue-body small { color: #708073; font-size: 11px; }.cue-actions { display: flex; }.highlight-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 7px; color: #718075; font-size: 11px; }.highlight-row select { min-width: 72px; height: 24px; border: 1px solid #d6ded7; border-radius: 3px; background: #fff; color: inherit; font: inherit; font-size: 11px; }.highlight-label { display: inline-block; padding: 1px 4px; border: 0; background: transparent; line-height: 1.35; cursor: pointer; font: inherit; }.removed-cues { margin: 14px 12px 0; border-top: 1px solid #e8ece8; color: #69756b; font-size: 12px; }.removed-cues summary { padding: 11px 0; cursor: pointer; }.removed-cue { display: flex; align-items: center; gap: 8px; padding: 7px 0; text-decoration: line-through; }.removed-cue span { flex: 1; min-width: 0; }
.instruction-panel { padding: 0 14px 14px; }.instruction-panel .panel-heading { margin: 0 -14px; }.instruction-input { box-sizing: border-box; width: 100%; min-height: 150px; margin: 14px 0 10px; padding: 10px; border: 1px solid #d6ded7; border-radius: 5px; resize: vertical; font: inherit; font-size: 13px; line-height: 1.55; }.instruction-input:focus { outline: 2px solid #c6e8cd; border-color: #62a571; }.suggestion-list, .personal-presets { display: flex; flex-wrap: wrap; gap: 6px; }.suggestion-list { margin-bottom: 10px; }.suggestion-list span, .personal-presets span { width: 100%; color: #7a857c; font-size: 12px; }.suggestion-list button, .personal-presets button { border: 1px solid #dbe5dc; border-radius: 4px; background: #fff; padding: 5px 7px; color: #3d6f49; font: inherit; font-size: 12px; cursor: pointer; }.suggestion-list button.selected, .personal-presets button.selected { border-color: #3d8b52; background: #edf8ef; }
.export-settings { margin-top: 14px; padding-top: 14px; border-top: 1px solid #e1e7e1; }.export-settings h2 { margin-bottom: 8px; font-size: 15px; }.ratio-toggle { display: flex; width: 100%; }.ratio-toggle :deep(.v-btn) { flex: 1; }.font-scale { display: flex; align-items: center; gap: 8px; margin-top: 8px; color: #68736a; font-size: 12px; }.font-scale span { flex: 0 0 52px; }.font-scale :deep(.v-slider) { flex: 1; }.position-slider { display: grid; grid-template-columns: 38px 1fr 38px; align-items: center; height: 40px; margin-top: 8px; color: #68736a; font-size: 11px; }.position-slider span:last-child { text-align: right; }.position-slider :deep(.v-slider) { min-width: 0; }.style-actions { display: flex; gap: 8px; margin-top: 8px; }.style-actions .v-btn { flex: 1; }.color-swatches { display: flex; gap: 14px; margin-top: 10px; }.color-swatches label { display: inline-flex; align-items: center; gap: 6px; color: #68736a; font-size: 12px; }.color-swatches input { width: 28px; height: 24px; padding: 1px; border: 1px solid #cfd8d0; border-radius: 4px; cursor: pointer; }.music-settings, .highlight-settings { margin-top: 14px; padding-top: 14px; border-top: 1px solid #e1e7e1; }.music-settings h2, .highlight-settings h2 { margin-bottom: 8px; font-size: 15px; }.music-file { display: flex; align-items: center; justify-content: space-between; gap: 6px; color: #526157; font-size: 12px; }.music-file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.music-settings audio { width: 100%; height: 32px; margin: 6px 0; }.music-volume { display: flex; align-items: center; gap: 8px; color: #68736a; font-size: 12px; }.music-volume span { flex: 0 0 58px; }.music-volume :deep(.v-slider) { flex: 1; }.highlight-template-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; font-size: 11px; font-weight: 700; }.export-status { display: flex; justify-content: space-between; margin: 12px 0; color: #68736a; font-size: 12px; }.export-status strong { color: #263129; font-size: 14px; }
.settings-content { display: grid; gap: 16px; }.settings-row, .settings-engine { display: flex; align-items: center; gap: 10px; }.settings-row > :first-child { flex: 1; }.settings-status, .settings-engine p { margin: 0; color: #68736a; font-size: 12px; }.settings-engine { justify-content: space-between; }.settings-engine strong { font-size: 14px; }
@media (max-width: 1100px) { .project-bar { gap: 3px; padding: 0 8px; }.project-select { width: 190px; }.workspace-nav { gap: 2px; }.workspace-nav button { padding: 0 7px; font-size: 12px; }.caption-workspace { grid-template-columns: minmax(260px, 320px) minmax(430px, 1fr); }.caption-actions { grid-column: 1 / -1; }.caption-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }.inspector-section { border-bottom: 0; }.structure-workspace { grid-template-columns: minmax(260px, 320px) minmax(390px, 1.5fr); }.instruction-panel { grid-column: 1 / -1; min-height: 230px; }.instruction-input { min-height: 100px; } }
@media (max-width: 900px) { .project-select { width: 140px; }.project-bar .mx-2 { margin-left: 0 !important; margin-right: 0 !important; }.workspace-nav button { padding: 0 5px; font-size: 11px; } }
@media (max-width: 700px) { .project-select { width: 120px; } }
</style>
