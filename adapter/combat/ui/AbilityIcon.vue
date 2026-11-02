<script setup lang="ts">
import { computed } from "vue"

const props = withDefaults(defineProps<{
  abilityHrid: string
  label?: string
  size?: number
  special?: boolean
}>(), {
  label: "",
  size: 32,
  special: false
})

const iconSlug = computed(() => String(props.abilityHrid || "").split("/").at(-1)?.replace(/[^a-z0-9_]/g, "") || "")
const iconUrl = computed(() => iconSlug.value ? `/game-icons/abilities/${iconSlug.value}.png` : "")
</script>

<template>
  <span
    class="ability-icon-tile"
    :class="{ special }"
    :style="{ '--ability-icon-size': `${size}px` }"
    :title="label"
    :aria-label="label || iconSlug"
  >
    <img v-if="iconUrl" :src="iconUrl" :alt="label" draggable="false">
  </span>
</template>

<style scoped>
.ability-icon-tile {
  width: var(--ability-icon-size);
  height: var(--ability-icon-size);
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--el-border-color) 82%, var(--el-color-primary));
  border-radius: max(5px, calc(var(--ability-icon-size) * .2));
  background: #111827;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 4%);
}
.ability-icon-tile.special { border-color: var(--el-color-warning-light-5); }
.ability-icon-tile img { width: 88%; height: 88%; object-fit: contain; }
</style>
