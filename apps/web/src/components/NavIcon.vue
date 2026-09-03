<script setup lang="ts">
withDefaults(
  defineProps<{
    name: "grid" | "key";
    active?: boolean;
  }>(),
  { active: false },
);
</script>

<template>
  <svg
    v-if="name === 'grid'"
    viewBox="0 0 24 24"
    fill="none"
    class="size-[18px] shrink-0"
    :class="active ? 'text-accent' : 'text-ink-faint group-hover:text-ink-muted'"
    aria-hidden="true"
  >
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5" />
  </svg>
  <svg
    v-else
    viewBox="0 0 24 24"
    fill="none"
    class="size-[18px] shrink-0"
    :class="active ? 'text-accent' : 'text-ink-faint group-hover:text-ink-muted'"
    aria-hidden="true"
  >
    <circle cx="8" cy="15.5" r="4" stroke="currentColor" stroke-width="1.5" />
    <path
      d="M11 12.5L18.5 5M18.5 5v3.5M18.5 5H15"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
