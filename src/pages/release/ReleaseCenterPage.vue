<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Stepper from '@/components/ui/Stepper.vue'
import DataGrid from '@/components/ui/DataGrid.vue'
import ParamEditor from '@/components/ui/ParamEditor.vue'
import { listNodes } from '@/api/services/nodes'
import { listTemplates } from '@/api/services/templates'
import { createRelease } from '@/api/services/releases'
import type { NodeRecord, TemplateRecord, ReleaseRecord } from '@/types/domain'
import { parseJsonObject } from '@/utils/format'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

const steps = ['选节点', '选配置', '参数预览', '发布确认']
const activeStep = ref(0)

const nodes = ref<NodeRecord[]>([])
const templates = ref<TemplateRecord[]>([])
const selectedNodes = ref<Set<string>>(new Set())
const selectedTemplates = ref<Set<string>>(new Set())
const paramsJson = ref('{}')
const pending = ref(false)
const latestRelease = ref<ReleaseRecord | null>(null)

const selectedNodeRows = computed(() => nodes.value.filter((item) => selectedNodes.value.has(item.id)))
const selectedTemplateRows = computed(() => templates.value.filter((item) => selectedTemplates.value.has(item.id)))

const selectedNodeTypes = computed(() => {
  return new Set(selectedNodeRows.value.map((item) => item.node_type))
})

const templatesWithStatus = computed(() => {
  return templates.value.map((template) => {
    if (selectedNodeTypes.value.size === 0) {
      return { ...template, compatible: true, warning: '' }
    }

    const unsupported = [...selectedNodeTypes.value].filter((type) => !template.node_types.includes(type))
    return {
      ...template,
      compatible: unsupported.length === 0,
      warning: unsupported.length > 0 ? `不支持: ${unsupported.join(', ')}` : '',
    }
  })
})

async function loadData(): Promise<void> {
  try {
    const [nodeRows, templateRows] = await Promise.all([listNodes(), listTemplates()])
    nodes.value = nodeRows
    templates.value = templateRows
  } catch {
    toastStore.push('发布中心数据加载失败', 'danger')
  }
}

function toggleNode(id: string): void {
  if (selectedNodes.value.has(id)) selectedNodes.value.delete(id)
  else selectedNodes.value.add(id)
  selectedNodes.value = new Set(selectedNodes.value)
}

function toggleTemplate(id: string, compatible: boolean): void {
  if (!compatible) return
  if (selectedTemplates.value.has(id)) selectedTemplates.value.delete(id)
  else selectedTemplates.value.add(id)
  selectedTemplates.value = new Set(selectedTemplates.value)
}

function nextStep(): void {
  if (activeStep.value === 0 && selectedNodes.value.size === 0) {
    toastStore.push('至少选择一个节点', 'warning')
    return
  }
  if (activeStep.value === 1 && selectedTemplates.value.size === 0) {
    toastStore.push('至少选择一个模板', 'warning')
    return
  }
  if (activeStep.value < steps.length - 1) activeStep.value += 1
}

function prevStep(): void {
  if (activeStep.value > 0) activeStep.value -= 1
}

async function publish(): Promise<void> {
  if (pending.value) return
  pending.value = true
  try {
    const params = parseJsonObject(paramsJson.value)
    latestRelease.value = await createRelease({
      node_ids: [...selectedNodes.value],
      template_ids: [...selectedTemplates.value],
      params,
    })
    toastStore.push('发布任务已创建', 'success')
    activeStep.value = 3
  } catch {
    toastStore.push('发布失败，请检查参数', 'danger')
  } finally {
    pending.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <section class="panel panel-pad" style="display: grid; gap: 14px">
    <Stepper :steps="steps" :active-index="activeStep" />

    <section v-if="activeStep === 0">
      <DataGrid title="步骤 1: 选择节点">
        <thead>
          <tr>
            <th></th>
            <th>节点</th>
            <th>类型</th>
            <th>区域</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="node in nodes" :key="node.id">
            <td><input type="checkbox" :checked="selectedNodes.has(node.id)" @change="toggleNode(node.id)" /></td>
            <td>{{ node.name }}</td>
            <td>{{ node.node_type }}</td>
            <td>{{ node.region || '-' }}</td>
            <td>{{ node.online ? '在线' : '离线' }}</td>
          </tr>
        </tbody>
      </DataGrid>
    </section>

    <section v-if="activeStep === 1">
      <DataGrid title="步骤 2: 选择模板">
        <thead>
          <tr>
            <th></th>
            <th>模板</th>
            <th>协议</th>
            <th>兼容性</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="template in templatesWithStatus" :key="template.id">
            <td>
              <input
                type="checkbox"
                :checked="selectedTemplates.has(template.id)"
                :disabled="!template.compatible"
                @change="toggleTemplate(template.id, template.compatible)"
              />
            </td>
            <td>{{ template.name }}</td>
            <td>{{ template.protocol }} / {{ template.transport }}</td>
            <td>
              <span v-if="template.compatible" class="badge success">兼容</span>
              <span v-else class="badge warning">{{ template.warning }}</span>
            </td>
          </tr>
        </tbody>
      </DataGrid>
    </section>

    <section v-if="activeStep === 2" style="display: grid; gap: 14px">
      <article class="panel panel-pad">
        <h3 style="margin-top: 0">步骤 3: 参数预览</h3>
        <p class="muted">将在 {{ selectedNodeRows.length }} 个节点上应用 {{ selectedTemplateRows.length }} 套模板。</p>
        <ParamEditor
          v-model="paramsJson"
          label="发布参数"
          :hint="'例如 { force: true, trace: manual }'"
        />
      </article>
    </section>

    <section v-if="activeStep === 3" style="display: grid; gap: 12px">
      <article class="panel panel-pad">
        <h3 style="margin-top: 0">步骤 4: 发布确认</h3>
        <div class="muted">目标节点：{{ selectedNodeRows.map((item) => item.name).join(', ') || '-' }}</div>
        <div class="muted">发布模板：{{ selectedTemplateRows.map((item) => item.name).join(', ') || '-' }}</div>
        <div class="muted">参数摘要：{{ paramsJson }}</div>
      </article>

      <article v-if="latestRelease" class="panel panel-pad">
        <strong>最近发布结果</strong>
        <div class="muted">发布号：v{{ latestRelease.version }}</div>
        <div class="muted">创建时间：{{ latestRelease.created_at }}</div>
      </article>
    </section>

    <div style="display: flex; gap: 8px; justify-content: flex-end">
      <button class="btn btn-secondary" :disabled="activeStep === 0" @click="prevStep">上一步</button>
      <button v-if="activeStep < 2" class="btn btn-primary" @click="nextStep">下一步</button>
      <button v-else-if="activeStep === 2" class="btn btn-primary" :disabled="pending" @click="publish">
        {{ pending ? '发布中...' : '执行发布' }}
      </button>
      <button v-else class="btn btn-primary" @click="activeStep = 0">新建发布</button>
    </div>
  </section>
</template>
