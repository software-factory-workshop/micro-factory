<script setup lang="ts">
import { Handle, MarkerType, Position, VueFlow, type Edge, type Node, type NodeMouseEvent } from "@vue-flow/core";
import { useVueFlow } from "@vue-flow/core";
import { flowStatusLabels, type FlowEdgeSpec, type FlowNodeSpec, type FlowStatus } from "../utils/observability-flow";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

const props = withDefaults(defineProps<{
  id: string;
  title: string;
  description?: string;
  nodes: readonly FlowNodeSpec[];
  edges: readonly FlowEdgeSpec[];
  selectedId?: string;
  height?: number;
}>(), {
  description: "Select a stage to inspect what the run has recorded.",
  height: 280,
});

const emit = defineEmits<{ select: [id: string] }>();
const flowPosition = Position;
const localSelectedId = ref<string>();
const manualSelection = ref(false);
const headingId = `flow-heading-${props.id}`;
const { fitView, zoomIn, zoomOut } = useVueFlow(props.id);

const selectedId = computed(() => localSelectedId.value || props.selectedId);
const selectedNode = computed(() => props.nodes.find((node) => node.id === selectedId.value));
const renderedNodes = computed<Node<FlowNodeSpec>[]>(() => props.nodes.map((node) => ({
  id: node.id,
  type: "default",
  position: node.position,
  width: node.width || 184,
  height: node.height || 86,
  data: node,
  selected: node.id === selectedId.value,
  draggable: false,
  connectable: false,
  selectable: true,
  focusable: true,
  targetPosition: flowPosition.Left,
  sourcePosition: flowPosition.Right,
  ariaLabel: `${node.title}. ${flowStatusLabels[node.status]}. ${node.subtitle}`,
})));
const renderedEdges = computed<Edge[]>(() => props.edges.map((edge) => {
  const status = edge.status || "queued";
  const color = status === "active" ? "#007f8c" : status === "complete" ? "#75a9ad" : status === "attention" ? "#b66b00" : status === "failed" ? "#c2413b" : "#c7d3d5";
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    label: edge.label,
    animated: status === "active",
    selectable: false,
    focusable: false,
    class: `edge-${status}`,
    style: { stroke: color, strokeWidth: status === "active" ? 2.4 : 1.6 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
    ariaLabel: edge.label ? `${edge.source} to ${edge.target}: ${edge.label}` : `${edge.source} to ${edge.target}`,
  };
}));

watch(() => props.selectedId, (value) => {
  if (value && !manualSelection.value) localSelectedId.value = value;
}, { immediate: true });

watch(() => props.nodes.map((node) => `${node.id}:${node.status}`), (keys) => {
  const ids = keys.map((key) => key.slice(0, key.lastIndexOf(":")));
  if (!ids.includes(localSelectedId.value || "")) {
    manualSelection.value = false;
    localSelectedId.value = props.nodes.find((node) => node.status === "active" || node.status === "attention")?.id || props.nodes.at(-1)?.id;
  } else if (!manualSelection.value && !props.selectedId) {
    localSelectedId.value = props.nodes.find((node) => node.status === "active" || node.status === "attention")?.id || props.nodes.at(-1)?.id;
  }
}, { immediate: true });

function selectNode(id: string) {
  manualSelection.value = true;
  localSelectedId.value = id;
  emit("select", id);
}

function onNodeClick(event: NodeMouseEvent) {
  selectNode(event.node.id);
}

async function resetView() {
  await fitView({ padding: 0.2, duration: 180 });
}

function onInit() {
  void fitView({ padding: 0.2 });
}

function statusLabel(status: string) {
  return flowStatusLabels[status as FlowStatus] || status;
}
</script>

<template>
  <section class="flow-shell" :aria-labelledby="headingId">
    <div class="flow-heading">
      <div>
        <p class="flow-eyebrow"><UIcon name="i-lucide-route" aria-hidden="true" /> Observability map</p>
        <h3 :id="headingId">{{ title }}</h3>
        <p class="flow-description">{{ description }}</p>
      </div>
      <div class="flow-toolbar" aria-label="Flow map controls">
        <span class="flow-interaction-hint"><UIcon name="i-lucide-mouse" aria-hidden="true" /> Drag to pan · scroll to zoom · stages below are keyboard friendly</span>
        <button type="button" aria-label="Zoom out" title="Zoom out" @click="zoomOut({ duration: 120 })"><UIcon name="i-lucide-minus" aria-hidden="true" /></button>
        <button type="button" aria-label="Fit map to view" title="Fit map to view" @click="resetView"><UIcon name="i-lucide-maximize-2" aria-hidden="true" /></button>
        <button type="button" aria-label="Zoom in" title="Zoom in" @click="zoomIn({ duration: 120 })"><UIcon name="i-lucide-plus" aria-hidden="true" /></button>
      </div>
    </div>

    <div class="flow-canvas" :style="{ height: `${height}px` }">
      <VueFlow
        :id="id"
        :nodes="renderedNodes"
        :edges="renderedEdges"
        fit-view-on-init
        :nodes-draggable="false"
        :nodes-connectable="false"
        :elements-selectable="true"
        :nodes-focusable="true"
        :edges-focusable="false"
        :zoom-on-scroll="true"
        :pan-on-drag="true"
        :min-zoom="0.45"
        :max-zoom="1.5"
        :default-edge-options="{ type: 'smoothstep' }"
        @init="onInit"
        @node-click="onNodeClick"
      >
        <template #node-default="{ data, selected }">
          <div class="flow-node" :class="[`status-${data.status}`, { 'is-selected': selected || data.id === selectedId }]">
            <Handle type="target" :position="flowPosition.Left" />
            <div class="flow-node-topline">
              <span class="flow-node-icon" aria-hidden="true"><UIcon :name="data.icon" /></span>
              <span class="flow-node-status">{{ statusLabel(data.status) }}</span>
            </div>
            <strong class="flow-node-title">{{ data.title }}</strong>
            <span class="flow-node-subtitle">{{ data.subtitle }}</span>
            <Handle type="source" :position="flowPosition.Right" />
          </div>
        </template>
      </VueFlow>
      <div v-if="!nodes.length" class="flow-empty">No activity has been recorded yet.</div>
    </div>

    <div class="flow-stage-list" role="list" aria-label="Flow stages">
      <button
        v-for="node in nodes"
        :key="node.id"
        type="button"
        class="flow-stage-chip"
        :class="{ selected: node.id === selectedId }"
        :aria-current="node.id === selectedId ? 'step' : undefined"
        @click="selectNode(node.id)"
      >
        <span class="flow-stage-dot" :class="`status-${node.status}`" aria-hidden="true" />
        <span>{{ node.title }}</span>
      </button>
    </div>

    <ol class="flow-linear" aria-label="Linear flow summary">
      <li v-for="(node, index) in nodes" :key="node.id">
        <button type="button" :class="{ selected: node.id === selectedId }" :aria-current="node.id === selectedId ? 'step' : undefined" @click="selectNode(node.id)">
          <span class="flow-linear-index" aria-hidden="true">{{ index + 1 }}</span>
          <span class="flow-linear-copy"><strong>{{ node.title }}</strong><small>{{ statusLabel(node.status) }} · {{ node.subtitle }}</small></span>
        </button>
      </li>
    </ol>

    <div v-if="selectedNode" class="flow-detail" role="status">
      <span class="flow-detail-icon" aria-hidden="true"><UIcon :name="selectedNode.icon" /></span>
      <div class="flow-detail-copy">
        <div class="flow-detail-heading"><strong>{{ selectedNode.title }}</strong><UBadge color="neutral" variant="soft">{{ flowStatusLabels[selectedNode.status] }}</UBadge></div>
        <p>{{ selectedNode.detail || selectedNode.subtitle }}</p>
        <span v-if="selectedNode.meta" class="flow-detail-meta">{{ selectedNode.meta }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.flow-shell {
  margin: 24px 0;
  border: 1px solid var(--ui-border, #e0e6e8);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}
.flow-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
  padding: 20px 22px 14px;
}
.flow-eyebrow {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 7px;
  color: var(--ui-primary, #007f8c);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.3px;
  text-transform: uppercase;
}
.flow-heading h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  text-wrap: balance;
}
.flow-description {
  max-width: 650px;
  margin: 5px 0 0;
  color: var(--ui-text-muted, #71808a);
  font-size: 12px;
  line-height: 1.55;
}
.flow-toolbar {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.flow-interaction-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-right: 7px;
  color: var(--ui-text-muted, #71808a);
  font-size: 11px;
  white-space: nowrap;
}
.flow-toolbar button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--ui-border, #d8e1e3);
  border-radius: 4px;
  background: #fff;
  color: var(--ui-text, #43525c);
  cursor: pointer;
  touch-action: manipulation;
}
.flow-toolbar button:hover,
.flow-toolbar button:focus-visible {
  border-color: var(--ui-primary, #007f8c);
  color: var(--ui-primary, #007f8c);
}
.flow-toolbar button:focus-visible,
.flow-stage-chip:focus-visible {
  outline: 2px solid var(--ui-primary, #007f8c);
  outline-offset: 2px;
}
.flow-canvas {
  position: relative;
  min-height: 210px;
  border-top: 1px solid #edf1f2;
  border-bottom: 1px solid #edf1f2;
  background-color: #f8fbfb;
  background-image: radial-gradient(#cad7d9 0.9px, transparent 0.9px);
  background-size: 18px 18px;
}
.flow-canvas :deep(.vue-flow) {
  background: transparent;
}
.flow-canvas :deep(.vue-flow__node-default) {
  width: 184px;
  height: 86px;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.flow-canvas :deep(.vue-flow__node-default.selected) {
  border: 0;
  box-shadow: none;
}
.flow-canvas :deep(.vue-flow__node-default:focus-visible) {
  outline: 2px solid var(--ui-primary, #007f8c);
  outline-offset: 3px;
}
.flow-canvas :deep(.vue-flow__edge-text) {
  fill: #71808a;
  font-size: 10px;
}
.flow-canvas :deep(.vue-flow__edge-textbg) {
  fill: #f8fbfb;
}
.flow-node {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  flex-direction: column;
  justify-content: center;
  padding: 13px 15px;
  border: 1px solid #c8d4d6;
  border-radius: 7px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(30, 60, 67, 0.06);
  color: #23313b;
  text-align: left;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.flow-node:hover,
.flow-node.is-selected {
  border-color: var(--ui-primary, #007f8c);
  box-shadow: 0 4px 14px rgba(0, 127, 140, 0.14);
  transform: translateY(-1px);
}
.flow-node-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
}
.flow-node-icon {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 5px;
  background: #edf3f3;
  color: #668087;
  font-size: 13px;
}
.flow-node-status {
  color: #77878c;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.flow-node-title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.flow-node-subtitle {
  overflow: hidden;
  margin-top: 3px;
  color: #71808a;
  font-size: 11px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.flow-node :deep(.vue-flow__handle) {
  width: 7px;
  height: 7px;
  border: 1px solid #fff;
  background: #94a9ad;
}
.flow-node.status-active {
  border-color: var(--ui-primary, #007f8c);
  box-shadow: 0 0 0 3px rgba(0, 127, 140, 0.1), 0 4px 14px rgba(0, 127, 140, 0.13);
}
.flow-node.status-active .flow-node-icon,
.flow-node.status-complete .flow-node-icon {
  background: #e4f3f2;
  color: var(--ui-primary, #007f8c);
}
.flow-node.status-active .flow-node-status {
  color: var(--ui-primary, #007f8c);
}
.flow-node.status-active .flow-node-icon {
  animation: flow-pulse 1.6s ease-in-out infinite;
}
.flow-node.status-attention {
  border-color: #d79b4c;
  background: #fffaf3;
}
.flow-node.status-attention .flow-node-icon {
  background: #fff0d9;
  color: #a76200;
}
.flow-node.status-attention .flow-node-status {
  color: #a76200;
}
.flow-node.status-failed {
  border-color: #d28a85;
  background: #fff8f7;
}
.flow-node.status-failed .flow-node-icon {
  background: #fbe8e5;
  color: #b23b35;
}
.flow-node.status-failed .flow-node-status {
  color: #b23b35;
}
.flow-node.status-queued .flow-node-icon,
.flow-node.status-idle .flow-node-icon {
  background: #f0f3f3;
  color: #8da0a5;
}
.flow-stage-list {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  padding: 12px 18px 2px;
  scrollbar-width: thin;
}
.flow-stage-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #66777e;
  font-size: 11px;
  cursor: pointer;
  touch-action: manipulation;
}
.flow-stage-chip:hover,
.flow-stage-chip.selected {
  border-color: #d5e1e2;
  background: #f3f8f8;
  color: #2d545c;
}
.flow-linear {
  display: none;
  margin: 0;
  padding: 12px 18px 2px;
  list-style: none;
}
.flow-linear li + li {
  border-top: 1px solid #edf1f2;
}
.flow-linear button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 12px 4px;
  border: 0;
  background: transparent;
  color: #66777e;
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
}
.flow-linear button.selected {
  color: #2d545c;
}
.flow-linear-index {
  display: grid;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid #d5e1e2;
  border-radius: 50%;
  font-size: 11px;
}
.flow-linear-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.flow-linear-copy strong {
  font-size: 12px;
  font-weight: 650;
}
.flow-linear-copy small {
  color: #8a999d;
  font-size: 11px;
}
.flow-stage-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #bdc9cb;
}
.flow-stage-dot.status-active { background: var(--ui-primary, #007f8c); box-shadow: 0 0 0 3px rgba(0, 127, 140, 0.12); }
.flow-stage-dot.status-complete { background: #4b9a8e; }
.flow-stage-dot.status-attention { background: #c47a14; }
.flow-stage-dot.status-failed { background: #c04a42; }
.flow-detail {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  min-height: 50px;
  padding: 14px 22px 17px;
  color: #5f7178;
}
.flow-detail-copy {
  min-width: 0;
}
.flow-detail-icon {
  display: grid;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 6px;
  background: #edf5f5;
  color: var(--ui-primary, #007f8c);
}
.flow-detail-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.flow-detail-heading strong {
  color: #30434b;
  font-size: 12px;
}
.flow-detail p {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
}
.flow-detail-meta {
  display: block;
  margin-top: 5px;
  color: #8a999d;
  font-size: 11px;
}
.flow-empty {
  display: grid;
  height: 100%;
  min-height: 210px;
  place-items: center;
  color: #71808a;
  font-size: 12px;
}
@keyframes flow-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(0, 127, 140, 0.12); }
  50% { box-shadow: 0 0 0 5px rgba(0, 127, 140, 0.08); }
}
@media (max-width: 700px) {
  .flow-heading { display: block; }
  .flow-toolbar { margin-top: 13px; }
  .flow-interaction-hint { margin-right: auto; }
  .flow-stage-list { display: none; }
  .flow-linear { display: block; }
}
@media (prefers-reduced-motion: reduce) {
  .flow-node, .flow-node.status-active .flow-node-icon { animation: none; transition: none; }
}
</style>
