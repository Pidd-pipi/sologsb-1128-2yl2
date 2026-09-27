<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { usePortStore } from '../stores/portStore';
import { useVesselStore } from '../stores/vesselStore';
import EmptyState from '../components/common/EmptyState.vue';
import { REVIEW_STATUSES, type ReviewStatus, type ReviewTask } from '../types/review';
import { issueTagType } from '../utils/verify';
import { formatDateTime, formatNumber } from '../utils/format';

const HANDLER_KEY = 'gbfishport:review-handler';

const router = useRouter();
const portStore = usePortStore();
const vesselStore = useVesselStore();

const activeTab = ref<ReviewStatus | '全部'>('待处理');

const tabCounts = computed(() => {
  const counts: Record<ReviewStatus, number> = { 待处理: 0, 已放行: 0, 已驳回: 0 };
  for (const task of portStore.reviews) counts[task.status] += 1;
  return counts;
});

const shownTasks = computed(() =>
  activeTab.value === '全部'
    ? portStore.reviewsSorted
    : portStore.reviewsSorted.filter((r) => r.status === activeTab.value),
);

const dialogVisible = ref(false);
const dialogAction = ref<'放行' | '驳回'>('放行');
const activeTask = ref<ReviewTask | null>(null);
const handling = ref(false);
const handleForm = reactive({ handler: '', note: '' });

onMounted(async () => {
  if (!portStore.ports.length) await portStore.loadAll();
  if (!vesselStore.vessels.length) await vesselStore.loadAll();
  handleForm.handler = localStorage.getItem(HANDLER_KEY) ?? '';
});

function statusTagType(status: ReviewStatus): 'warning' | 'success' | 'info' {
  if (status === '待处理') return 'warning';
  if (status === '已放行') return 'success';
  return 'info';
}

function openHandle(task: ReviewTask, action: '放行' | '驳回'): void {
  activeTask.value = task;
  dialogAction.value = action;
  handleForm.note = '';
  dialogVisible.value = true;
}

async function submitHandle(): Promise<void> {
  const task = activeTask.value;
  if (!task) return;
  const handler = handleForm.handler.trim();
  if (!handler) {
    ElMessage.warning('请填写处理人');
    return;
  }
  handling.value = true;
  try {
    localStorage.setItem(HANDLER_KEY, handler);
    if (dialogAction.value === '放行') {
      const call = await portStore.confirmReview(task.id, handler, handleForm.note);
      if (call) {
        ElMessage.success(`已放行并写入流水：${call.vesselName} ${call.type} · ${task.portName} ${call.berthNo}`);
      }
    } else {
      await portStore.rejectReview(task.id, handler, handleForm.note);
      ElMessage.info(`已驳回 ${task.vesselName} 的${task.type}申报，未写入流水`);
    }
    dialogVisible.value = false;
  } catch (error) {
    ElMessage.error(`处理失败：${(error as Error).message}`);
  } finally {
    handling.value = false;
  }
}

function openVessel(vesselId: string): void {
  void router.push(`/vessels/${vesselId}`);
}

function openPort(portId: string): void {
  void router.push(`/ports/${portId}`);
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h1>核验待办</h1>
        <p class="page__sub">
          进出港登记核验未通过的申报先进入待办，写明原因与涉及渔港；处理人确认放行后才写入正常流水，驳回仅留痕
        </p>
      </div>
      <el-button type="primary" @click="router.push('/calls')">登记进出港</el-button>
    </header>

    <el-card shadow="never" class="detail-card">
      <el-tabs v-model="activeTab" data-testid="review-tabs">
        <el-tab-pane v-for="s in REVIEW_STATUSES" :key="s" :name="s">
          <template #label>
            <el-badge :value="tabCounts[s]" :hidden="tabCounts[s] === 0" :type="s === '待处理' ? 'warning' : 'info'">
              {{ s }}
            </el-badge>
          </template>
        </el-tab-pane>
        <el-tab-pane label="全部" name="全部" />
      </el-tabs>

      <el-table v-if="shownTasks.length" :data="shownTasks" size="small" border data-testid="review-table">
        <el-table-column label="渔船" min-width="150">
          <template #default="scope">
            <el-link type="primary" @click="openVessel(scope.row.vesselId)">{{ scope.row.vesselName }}</el-link>
            <span class="cell-sub">{{ scope.row.vesselNo }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="70" />
        <el-table-column label="申报时间" min-width="140">
          <template #default="scope">{{ formatDateTime(scope.row.time) }}</template>
        </el-table-column>
        <el-table-column label="涉及渔港" min-width="140">
          <template #default="scope">
            <el-link type="primary" @click="openPort(scope.row.portId)">{{ scope.row.portName }}</el-link>
            <span class="cell-sub">泊位 {{ scope.row.berthNo }}</span>
          </template>
        </el-table-column>
        <el-table-column label="核验未通过原因" min-width="260">
          <template #default="scope">
            <div class="issue-list">
              <div v-for="issue in scope.row.issues" :key="issue.code + issue.detail" class="issue-item">
                <el-tag size="small" :type="issueTagType(issue.code)" effect="dark">{{ issue.code }}</el-tag>
                <span>{{ issue.detail }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="申报内容" min-width="170">
          <template #default="scope">
            加冰 {{ formatNumber(scope.row.payload.iceKg, 0) }} kg · 加油 {{ formatNumber(scope.row.payload.fuelL, 0) }} L · 卸货
            {{ formatNumber(scope.row.payload.unloadKg, 0) }} kg
          </template>
        </el-table-column>
        <el-table-column label="状态 / 处理" min-width="170">
          <template #default="scope">
            <el-tag size="small" :type="statusTagType(scope.row.status)">{{ scope.row.status }}</el-tag>
            <template v-if="scope.row.status !== '待处理'">
              <div class="cell-sub">{{ scope.row.handler }} · {{ formatDateTime(scope.row.handledAt) }}</div>
              <div v-if="scope.row.note" class="cell-sub">备注：{{ scope.row.note }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="scope">
            <template v-if="scope.row.status === '待处理'">
              <el-button text type="success" size="small" data-testid="approve-review" @click="openHandle(scope.row, '放行')">
                放行
              </el-button>
              <el-button text type="danger" size="small" data-testid="reject-review" @click="openHandle(scope.row, '驳回')">
                驳回
              </el-button>
            </template>
            <span v-else class="cell-sub">已处理</span>
          </template>
        </el-table-column>
      </el-table>

      <EmptyState
        v-else
        :title="activeTab === '待处理' ? '没有待处理的核验申报' : '该状态下暂无记录'"
        :description="activeTab === '待处理' ? '核验未通过的进出港申报会出现在这里，等待处理人确认。' : '切换其他状态页签查看历史处理记录。'"
      >
        <el-button v-if="activeTab === '待处理'" type="primary" @click="router.push('/calls')">前往登记</el-button>
      </EmptyState>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogAction === '放行' ? '放行确认' : '驳回确认'"
      width="520px"
      data-testid="handle-dialog"
    >
      <template v-if="activeTask">
        <el-alert
          :type="dialogAction === '放行' ? 'warning' : 'info'"
          show-icon
          :closable="false"
          class="handle-alert"
          :title="
            dialogAction === '放行'
              ? `确认放行后，${activeTask.vesselName} 的${activeTask.type}申报将写入正常流水并同步泊位状态`
              : `驳回后不会写入流水，仅保留处理痕迹`
          "
        />
        <el-descriptions :column="1" size="small" border class="handle-desc">
          <el-descriptions-item label="渔船">{{ activeTask.vesselName }}（{{ activeTask.vesselNo }}）</el-descriptions-item>
          <el-descriptions-item label="涉及渔港">{{ activeTask.portName }} · 泊位 {{ activeTask.berthNo }}</el-descriptions-item>
          <el-descriptions-item label="申报时间">{{ formatDateTime(activeTask.time) }}</el-descriptions-item>
          <el-descriptions-item label="未通过原因">
            <div class="issue-list">
              <div v-for="issue in activeTask.issues" :key="issue.code + issue.detail" class="issue-item">
                <el-tag size="small" :type="issueTagType(issue.code)" effect="dark">{{ issue.code }}</el-tag>
                <span>{{ issue.detail }}</span>
              </div>
            </div>
          </el-descriptions-item>
        </el-descriptions>
        <el-form label-width="80px">
          <el-form-item label="处理人" required>
            <el-input id="handle-handler" v-model="handleForm.handler" placeholder="请输入处理人姓名" data-testid="handle-handler" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input
              id="handle-note"
              v-model="handleForm.note"
              type="textarea"
              :rows="2"
              :placeholder="dialogAction === '放行' ? '如：已现场复核证书，准予进港' : '如：证书过期，通知船东换证后再申报'"
            />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button
          :type="dialogAction === '放行' ? 'success' : 'danger'"
          :loading="handling"
          data-testid="submit-handle"
          @click="submitHandle"
        >
          确认{{ dialogAction }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.page__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.page__head h1 {
  margin: 0;
  font-size: 22px;
  color: #17324d;
}
.page__sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: #6b7c8c;
}
.detail-card {
  border-radius: 10px;
  margin-bottom: 16px;
}
.cell-sub {
  display: block;
  font-size: 12px;
  color: #8592a0;
}
.issue-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.issue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #4b5c6d;
}
.handle-alert {
  margin-bottom: 12px;
}
.handle-desc {
  margin-bottom: 16px;
}
</style>
