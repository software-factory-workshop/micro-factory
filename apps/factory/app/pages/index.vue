<script setup lang="ts">
import { createHash } from "node:crypto";
import { MIN_WORK_REQUEST_LENGTH } from "../utils/work-station";
import { cockpitFailureMessage } from "../utils/cockpit-errors";
import { missingCapabilities, prototypeRepository, factoryRepository } from "../../runtime/lib/factory-config.ts";

const cockpit = useCockpit();
const router = useRouter();
const title = ref("Migrate the ADEO todo prototype to Nuxt");
const brief = ref(`Migrate the v0 prototype ${prototypeRepository} into the Nuxt 4 shell in ${factoryRepository}. Every page and interaction of the prototype gets a Nuxt counterpart on the ADEO layer. Replace Neon with AWS DSQL behind one typed data module with the same query surface and a labelled fixture fallback. Keep Vercel Passport as the front door and Vercel Connect for the Jira MCP. Add Vitest unit tests and headless Playwright e2e tests through agent-browser.`);
const outcome = ref("A draft PR with a Nuxt 4 application that passes typecheck, unit, e2e and build, with fixtures labelled and no secret in source.");
const scope = ref("app/, server/, shared/, tests/, e2e/ in the target repository\nNo change to package.json, lockfile, nuxt.config.ts, CI or factory policy");
const evidence = ref("Command evidence for pnpm typecheck, pnpm test, pnpm test:e2e, pnpm build on the candidate digest\nUnit test count on head at least the base count\nNo secret pattern in the diff");
const verification = ref("Quality gate reruns all checks on the exact head\nSecurity gate checks secrets, injection, authorization, SSRF and dependency advisories");
const saving = ref(false);
const error = ref("");
const draftId = ref("");
const briefReady = computed(() => brief.value.trim().length >= MIN_WORK_REQUEST_LENGTH);
const lines = (value: string) => value.split("\n").map(item => item.trim()).filter(Boolean);

function stableId() {
  if (typeof window === "undefined") return `project-${Date.now()}`;
  return `project-${Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, "0")).join("")}`;
}
void createHash;

async function admit() {
  if (saving.value || !briefReady.value || !title.value.trim()) return;
  saving.value = true;
  error.value = "";
  try {
    const id = draftId.value || stableId();
    const existing = cockpit.items.value.drafts.find(item => item.id === id);
    await cockpit.save("drafts", id, {
      title: title.value.trim(),
      request: brief.value.trim(),
      admission: { kind: "work_order", outcome: outcome.value.trim(), scope: lines(scope.value), evidence: lines(evidence.value), verification: lines(verification.value) },
    }, existing?.version ?? 0);
    draftId.value = id;
  } catch (cause) {
    error.value = cockpitFailureMessage(cause, "The project brief");
  } finally {
    saving.value = false;
  }
}
onMounted(() => { void cockpit.refresh("drafts").catch(() => undefined); });
function openDraft(id: string) { void router.push({ path: "/work/run", query: { delivery: id } }); }
</script>

<template>
  <AdeoPageHeader eyebrow="WORKSPACE · PROJECTS" title="Migrate a v0 prototype" description="Write the brief, admit it as a work order, then start the durable migration. The migrator publishes one draft PR; two gates review the exact head; a person merges.">
    <template #actions>
      <UButton to="/work/recent" color="neutral" variant="outline" icon="i-lucide-history">Recent work</UButton>
    </template>
  </AdeoPageHeader>

  <section class="panel" style="padding: 24px; margin-top: 24px">
    <div class="panel-heading"><h2>Brief and admission</h2><UBadge :color="draftId ? 'success' : 'neutral'" variant="soft">{{ draftId ? 'Admitted as work order' : 'Not admitted' }}</UBadge></div>
    <div class="form-grid">
      <UFormField label="Title" name="title"><UInput v-model="title" :maxlength="160" /></UFormField>
      <UFormField label="Brief" name="brief" :help="`At least ${MIN_WORK_REQUEST_LENGTH} characters. The migrator receives exactly this text.`"><UTextarea v-model="brief" :rows="6" :maxlength="18000" /></UFormField>
      <UFormField label="Outcome" name="outcome"><UTextarea v-model="outcome" :rows="2" /></UFormField>
      <UFormField label="Scope (one per line)" name="scope"><UTextarea v-model="scope" :rows="3" /></UFormField>
      <UFormField label="Evidence (one per line)" name="evidence"><UTextarea v-model="evidence" :rows="3" /></UFormField>
      <UFormField label="Verification (one per line)" name="verification"><UTextarea v-model="verification" :rows="3" /></UFormField>
    </div>
    <div class="form-actions">
      <UButton :disabled="!briefReady || !title.trim() || saving" :loading="saving" icon="i-lucide-file-check-2" @click="admit">{{ draftId ? 'Update admitted brief' : 'Admit as work order' }}</UButton>
      <p class="small muted">Only a brief admitted as a work order can start the migrator; the Cedar policy <code>factory-workflow-starts-admitted-work-order</code> is checked by the host at start.</p>
    </div>
    <UAlert v-if="error" color="warning" variant="soft" title="Brief not saved" :description="error" />
  </section>

  <DeliveryLoop v-if="draftId" :title="title" :brief="brief" :draft-id="draftId" mode="compose" @started="(value) => openDraft(value.id)" />

  <section class="panel" style="padding: 24px; margin-top: 24px">
    <div class="panel-heading"><h2>Not in this factory (v1)</h2></div>
    <ul class="missing"><li v-for="item in missingCapabilities" :key="item">{{ item }}</li></ul>
  </section>
</template>

<style scoped>
.form-grid { display: grid; gap: 14px; margin-top: 16px; }
.form-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 18px; }
.missing { margin: 12px 0 0; padding-left: 20px; list-style: disc; color: var(--ui-text-muted); line-height: 1.7; }
</style>
