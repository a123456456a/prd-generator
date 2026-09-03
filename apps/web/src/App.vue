<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppShell from "@/components/AppShell.vue";

const route = useRoute();
const isBareLayout = computed(() => route.meta.layout === "bare");
</script>

<template>
  <AppShell v-if="!isBareLayout">
    <RouterView />
  </AppShell>
  <RouterView v-else />
</template>
