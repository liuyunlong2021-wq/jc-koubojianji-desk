<template>
  <div class="layout-container" :class="{ 'is-mac': isMac }" :style="layoutStyle">
    <div class="logo" v-if="!route.meta.hideAppIcon">
      <img src="/talking-head-logo.svg" alt="" />
      <span>{{ route.path === '/film-breakdown' ? '影片拉片' : '口播剪辑器' }}</span>
    </div>
    <div class="window-control-bar">
      <div class="window-no-drag">
        <v-menu location="bottom right">
          <template v-slot:activator="{ props }">
            <div class="control-btn control-btn-zoom" v-bind="props">
              <v-icon icon="mdi-magnify-plus-outline" />
            </div>
          </template>
          <v-list
            class="p-2 space-y-1"
            activatable
            :activated="[zoomFactor]"
            @update:activated="handleChangeZoom"
          >
            <v-list-item
              v-for="(item, index) in zoomDisplayOptions"
              :key="index"
              :value="item.value"
              color="primary"
              density="compact"
              rounded
            >
              <v-list-item-title>{{ item.label }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
      <template v-if="!isMac">
        <div class="control-btn control-btn-min" @click="handleMin">
          <v-icon icon="mdi-window-minimize" size="small" />
        </div>
        <div class="control-btn control-btn-max" @click="handleMax">
          <v-icon icon="mdi-window-maximize" size="small" v-if="!windowIsMaxed" />
          <v-icon icon="mdi-window-restore" size="small" v-else />
        </div>
        <div class="control-btn control-btn-close" @click="handleClose">
          <v-icon icon="mdi-window-close" size="small" />
        </div>
      </template>
    </div>
    <RouterView />
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
watchEffect(() => { document.title = route.path === '/film-breakdown' ? '影片拉片' : '口播剪辑器' })
const isMac = window.electron?.platform === 'darwin'
const layoutStyle = {
  '--window-control-mask-width': isMac ? '84px' : '210px',
}
const windowIsMaxed = ref(false)
const zoomOptions = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const savedZoom = Number(localStorage.getItem('jc-app-zoom'))
const zoomFactor = ref(zoomOptions.includes(savedZoom) ? savedZoom : 1)

const zoomDisplayOptions = zoomOptions.map((factor) => ({
  value: factor,
  label: `${Math.round(factor * 100)}%`,
}))

const handleChangeZoom = (factor: unknown) => {
  const selectedZoom = (factor as number[])[0]
  if (selectedZoom) {
    window.electron.setZoomFactor(selectedZoom)
    localStorage.setItem('jc-app-zoom', String(selectedZoom))
    zoomFactor.value = selectedZoom
  }
}

onMounted(() => {
  window.electron?.setZoomFactor(zoomFactor.value)
})

window.addEventListener('resize', async () => {
  if (window.electron) windowIsMaxed.value = await window.electron.isWinMaxed()
})

const handleMin = () => {
  window.electron?.winMin()
}
const handleMax = () => {
  window.electron?.winMax()
}
const handleClose = () => {
  window.electron?.winClose()
}
</script>

<style lang="scss" scoped>
.layout-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  position: relative;

  --title-bar-height: 40px;

  .logo {
    position: absolute;
    z-index: 9999;
    top: 0;
    left: 0;
    height: var(--title-bar-height);
    padding-left: 15px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    user-select: none;
    -webkit-app-region: drag;

    img {
      width: 20px;
      height: 20px;
    }
  }

  &.is-mac {
    .logo {
      padding-left: 84px;
      pointer-events: none;
      -webkit-app-region: no-drag;
    }
  }

  .window-control-bar {
    position: absolute;
    z-index: 9999;
    top: 0;
    right: 0;
    display: flex;
    align-items: center;
    font-size: 14px;
    user-select: none;

    .control-btn {
      transition: all 0.1s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      width: 42px;
      height: var(--title-bar-height);
      box-sizing: border-box;
      -webkit-app-region: no-drag;

      &:hover {
        @apply bg-gray-200;
      }

      &-close {
        &:hover {
          @apply text-white bg-red-600;
        }
      }
    }

  }
}
</style>
