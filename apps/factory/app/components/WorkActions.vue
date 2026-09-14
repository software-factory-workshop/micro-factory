<script setup lang="ts">
import { stationLinkSchema, type StationLink } from "../utils/work-station";

const route = useRoute();
const active = ref<StationLink>();

watch(() => route.query, (query) => {
  const linked = stationLinkSchema.safeParse(query);
  if (linked.success) active.value = linked.data;
}, { immediate: true });
</script>

<template>
  <section v-if="active" class="work-stations">
    <ClientOnly>
      <WorkRun
        :key="`${active.run}:${active.operationId || ''}`"
        :session-id="active.run"
        :station="active.station"
        :execution="active.execution"
        :root-agent="active.rootAgent"
        :delivery-id="active.deliveryId"
        :operation-id="active.operationId"
      />
    </ClientOnly>
  </section>
</template>

<style scoped>
.work-stations { margin: 36px 0; }
</style>
