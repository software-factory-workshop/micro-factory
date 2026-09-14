<script setup lang="ts">
import { stationLinkSchema } from "../../utils/work-station";

const route = useRoute();
function hasValue(value: unknown) {
  return Array.isArray(value) ? value.some(item => typeof item === "string" && item.length > 0) : typeof value === "string" && value.length > 0;
}
const hasDelivery = computed(() => hasValue(route.query.delivery));
const hasStation = computed(() => stationLinkSchema.safeParse(route.query).success);
const hasSelectedRun = computed(() => hasDelivery.value || hasStation.value);
</script>

<template>
  <AdeoPageHeader
    eyebrow="WORKSPACE · PROJECT"
    title="Follow the project"
    :description="hasSelectedRun ? 'Brief and admission, phase timeline, attempts, findings and command evidence for one project. Verdicts apply to an exact head; no merge is performed here.' : 'Select a project from Recent work or start one from Projects.'"
  >
    <template #actions>
      <UButton to="/" icon="i-lucide-folder-kanban">Projects</UButton>
      <UButton to="/work/recent" color="neutral" variant="outline" icon="i-lucide-history">Recent work</UButton>
    </template>
  </AdeoPageHeader>

  <section v-if="!hasSelectedRun" class="empty-run panel">
    <UIcon name="i-lucide-workflow" aria-hidden="true" />
    <div>
      <h2>No project selected</h2>
      <p class="muted">Open a project from Recent work, or admit a new brief on Projects.</p>
    </div>
  </section>

  <template v-else>
    <WorkActions v-if="hasStation" />
    <DeliveryLoop v-if="hasDelivery" mode="run" />
  </template>
</template>

<style scoped>
.empty-run { display: flex; gap: 16px; align-items: flex-start; margin-top: 30px; padding: 24px; }
.empty-run > svg { flex: 0 0 auto; color: var(--ui-primary); font-size: 22px; }
.empty-run h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
.empty-run p { margin: 0; }
</style>
