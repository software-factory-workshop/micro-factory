<template>
  <AdeoPageHeader eyebrow="WORKSPACE · RECENT WORK" title="Recent work" description="Reopen a project or a station run from shared, versioned cockpit storage.">
    <template #actions>
      <UButton to="/" icon="i-lucide-folder-kanban">Projects</UButton>
    </template>
  </AdeoPageHeader>
  <WorkHistory :show-heading="false" />
</template>
