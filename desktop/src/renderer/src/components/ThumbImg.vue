<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { NIcon } from 'naive-ui'
import { VideocamOutline } from '@vicons/ionicons5'

const props = defineProps<{ videoId: number; thumbnailPath: string | null }>()

// 模块级内存缓存（避免重复 IPC）
const cache = new Map<number, string>()
const src = ref<string | null>(null)

async function load(): Promise<void> {
  if (!props.thumbnailPath) {
    src.value = null
    return
  }
  const cached = cache.get(props.videoId)
  if (cached !== undefined) {
    src.value = cached
    return
  }
  const dataUrl = await window.api.getThumbnail(props.videoId)
  if (dataUrl) {
    cache.set(props.videoId, dataUrl)
    src.value = dataUrl
  } else {
    src.value = null
  }
}

onMounted(() => {
  void load()
})

watch(() => props.videoId, () => void load())
</script>

<template>
  <img v-if="src" :src="src" class="thumb" loading="lazy" alt="" />
  <div v-else class="thumb-placeholder">
    <n-icon :size="28"><VideocamOutline /></n-icon>
  </div>
</template>

<style scoped>
.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-disabled);
}
</style>
