<script setup lang="ts">
import { computed } from "vue"

const props = withDefaults(defineProps<{
  itemHrid: string
  label?: string
  size?: number
}>(), {
  label: "",
  size: 38
})

const iconSlug = computed(() => String(props.itemHrid || "").split("/").at(-1)?.replace(/[^a-z0-9_]/g, "") || "")
</script>

<template>
  <span
    class="item-icon-tile"
    :class="{ empty: !iconSlug }"
    :style="{ '--item-icon-size': `${size}px` }"
    :title="label"
    :aria-label="label || iconSlug"
  >
    <svg v-if="iconSlug" viewBox="0 0 50 50" aria-hidden="true">
      <use :href="`/game-icons/items_sprite.svg#${iconSlug}`" />
    </svg>
    <span v-else aria-hidden="true">—</span>
  </span>
</template>

<style scoped>
.item-icon-tile {
  width: var(--item-icon-size);
  height: var(--item-icon-size);
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--el-border-color) 82%, var(--el-color-primary));
  border-radius: max(5px, calc(var(--item-icon-size) * .2));
  background: #111827;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 4%);
}
.item-icon-tile svg { width: 90%; height: 90%; }
.item-icon-tile.empty { color: var(--el-text-color-secondary); background: var(--el-fill-color-light); }
</style>
