<script setup lang="ts">
import { factoryRepositoryUrl, prototypeRepositoryUrl } from "../runtime/lib/factory-config.ts";

const config = useRuntimeConfig();
const route = useRoute();
const sectionLabel = computed(() => {
  if (route.path === "/work/run") return "Project";
  if (route.path === "/work/recent") return "Recent work";
  return "Projects";
});
</script>

<template>
  <UApp>
    <div class="factory-layout">
      <aside class="sidebar">
        <NuxtLink class="brand" to="/">ADEO<span>micro-factory</span></NuxtLink>
        <div class="workspace-name">
          <span class="workspace-icon">v0</span>
          <div>Prototype to Nuxt<small>Software factory workshop</small></div>
        </div>
        <div class="nav-label">WORKSPACE</div>
        <nav aria-label="Cockpit navigation">
          <NuxtLink to="/" :class="{ active: route.path === '/' }" :aria-current="route.path === '/' ? 'page' : undefined"><UIcon name="i-lucide-folder-kanban" aria-hidden="true" />Projects</NuxtLink>
          <NuxtLink to="/work/run" :class="{ active: route.path === '/work/run' }" :aria-current="route.path === '/work/run' ? 'page' : undefined"><UIcon name="i-lucide-workflow" aria-hidden="true" />Project run</NuxtLink>
          <NuxtLink to="/work/recent" :class="{ active: route.path === '/work/recent' }" :aria-current="route.path === '/work/recent' ? 'page' : undefined"><UIcon name="i-lucide-history" aria-hidden="true" />Recent work</NuxtLink>
        </nav>
        <div class="sidebar-bottom">
          <UButton :to="prototypeRepositoryUrl" target="_blank" color="neutral" variant="ghost" icon="i-lucide-github">Prototype repo</UButton>
          <UButton :to="factoryRepositoryUrl" target="_blank" color="neutral" variant="ghost" icon="i-lucide-github">Target repo</UButton>
          <p class="sidebar-build">Factory SHA <code>{{ config.public.factorySha || 'local' }}</code></p>
        </div>
      </aside>
      <main>
        <header class="topbar">
          <span>Workshop / <strong>{{ sectionLabel }}</strong></span>
          <UBadge color="neutral" variant="subtle">{{ sectionLabel }}</UBadge>
        </header>
        <div class="page-content">
          <NuxtPage />
        </div>
      </main>
    </div>
  </UApp>
</template>
