<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { usePortStore } from '../stores/portStore';
import { useVesselStore } from '../stores/vesselStore';
import EmptyState from '../components/common/EmptyState.vue';
import type { CallReviewTask, ReviewStatus } from '../types/review';
import { formatDateTime, formatNumber } from '../utils/format';

const router = useRouter();
const portStore = usePortStore();
const vesselStore = useVesselStore();

const activeStatus = ref<ReviewStatus | ''>('待处理');
const activeTask = ref<CallReviewTask | null>(null);
const dialogMode = ref<'approve' | 'reject'>('approve');
const dialogVisible = ref(false);
const formRef = ref<FormInstance>();
const saving = ref(false);

const reviewForm = reactive({
  reviewedBy: '',
  note: '',
});

const dynamicRules = computed<FormRules>(() => ({
  reviewedBy: [{ required: true, message: '请填写处理人姓名', trigger: 'blur' }],
  note:
    dialogMode.value === 'reject'
      ? [{ required: true, message: '请填写驳回说明', trigger: 'blur' }]
      : [],
}));

const filteredReviews = computed(() =>
  activeStatus.value
    ? portStore.reviewsSorted.filter((item) => item.status === activeStatus.value)
    : portStore.reviewsSorted,
);

function issueTagType(status: ReviewStatus): 'warning' | 'success' | 'danger' {
  if (status === '已放行') return 'success';
  if (status === '已驳回') return 'danger';
  return 'warning';
}

function openDialog(task: CallReviewTask, mode: 'approve' | 'reject'): void {
  activeTask.value = task;
  dialogMode.value = mode;
  Object.assign(reviewForm, { reviewedBy: '', note: '' });
  dialogVisible.value = true;
}

async function submitDecision(): Promise<void> {
  if (!activeTask.value || !formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (dialogMode.value === 'approve') {
      await portStore.approveReview(activeTask.value.id, reviewForm.reviewedBy, vesselStore.vessels, reviewForm.note);
      ElMessage.success('已确认放行，并形成正常进出港流水');
    } else {
      await portStore.rejectReview(activeTask.value.id, reviewForm.reviewedBy, reviewForm.note);
      ElMessage.success('已驳回该核验申请');
    }
    dialogVisible.value = false;
  } catch (error) {
    ElMessage.error(`处理失败：${(error as Error).message}`);
  } finally {
    saving.value = false;
  }
}

function openVessel(vesselId: string): void {
  void router.push(`/vessels/${vesselId}`);
}

onMounted(async () => {
  if (!portStore.ports.length || !portStore.reviews.length) await portStore.loadAll();
  if (!vesselStore.vessels.length) await vesselStore.loadAll();
});
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h1>进出港核验待办</h1>
        <p class="page__sub">证书过期、吃水超泊位水深、编号重号或泊位条件不符的申请先拦截，确认后才进入正常流水</p>
      </div>
      <el-button type="primary" @click="router.push('/calls')">返回登记</el-button>
    </header>

    <el-card shadow="never" class="filter-card">
      <div class="status-row">
        <el-radio-group v-model="activeStatus" data-testid="review-status-filter">
          <el-radio-button value="待处理">待处理（{{ portStore.pendingReviewCount }}）</el-radio-button>
          <el-radio-button value="已放行">已放行</el-radio-button>
          <el-radio-button value="已驳回">已驳回</el-radio-button>
          <el-radio-button value="">全部</el-radio-button>
        </el-radio-group>
      </div>
    </el-card>

    <el-table v-if="filteredReviews.length" :data="filteredReviews" border size="small" data-testid="review-table">
      <el-table-column label="状态" width="100">
        <template #default="scope">
          <el-tag :type="issueTagType(scope.row.status)">{{ scope.row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="type" label="类型" width="70" />
      <el-table-column label="渔船" min-width="150">
        <template #default="scope">
          <el-link type="primary" @click="openVessel(scope.row.vesselId)">{{ scope.row.vesselName }}</el-link>
          <span class="muted">{{ scope.row.vesselNo }}</span>
        </template>
      </el-table-column>
      <el-table-column label="涉及渔港 / 泊位" min-width="170">
        <template #default="scope">{{ scope.row.portName }} · {{ scope.row.berthNo }}</template>
      </el-table-column>
      <el-table-column label="吃水 / 泊位水深" min-width="130">
        <template #default="scope">
          {{ formatNumber(scope.row.draftDepth) }} /
          {{ scope.row.berthDepth === null ? '—' : formatNumber(scope.row.berthDepth) }} m
        </template>
      </el-table-column>
      <el-table-column prop="certificateExpiry" label="证书有效期" min-width="110" />
      <el-table-column label="拦截原因" min-width="260">
        <template #default="scope">
          <div class="reasons">
            <el-tag v-for="reason in scope.row.reasons" :key="reason" size="small" type="danger" effect="plain">
              {{ reason }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" min-width="150">
        <template #default="scope">{{ formatDateTime(scope.row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="处理信息" min-width="170">
        <template #default="scope">
          <template v-if="scope.row.status === '待处理'">等待处理人确认</template>
          <template v-else>
            <div>{{ scope.row.reviewedBy }} · {{ formatDateTime(scope.row.reviewedAt) }}</div>
            <div v-if="scope.row.reviewNote" class="muted">{{ scope.row.reviewNote }}</div>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="scope">
          <template v-if="scope.row.status === '待处理'">
            <el-button text type="success" size="small" data-testid="approve-review" @click="openDialog(scope.row, 'approve')">
              确认放行
            </el-button>
            <el-button text type="danger" size="small" data-testid="reject-review" @click="openDialog(scope.row, 'reject')">
              驳回
            </el-button>
          </template>
          <span v-else class="muted">已归档</span>
        </template>
      </el-table-column>
    </el-table>

    <EmptyState v-else title="暂无核验待办" description="通过进出港登记页提交申请；存在证书、吃水、重号或泊位问题时会自动进入这里。">
      <el-button type="primary" @click="router.push('/calls')">去登记进出港</el-button>
    </EmptyState>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'approve' ? '确认放行核验待办' : '驳回核验申请'"
      width="560px"
      data-testid="review-dialog"
    >
      <template v-if="activeTask">
        <el-alert
          v-if="dialogMode === 'approve'"
          type="warning"
          show-icon
          :closable="false"
          title="放行时会按最新档案和泊位状态复核；证书、吃水、重号问题可由处理人确认承担，泊位冲突仍不能放行。"
          class="dialog-alert"
        />
        <el-descriptions :column="1" size="small" border class="dialog-desc">
          <el-descriptions-item label="申请">
            {{ activeTask.vesselName }}（{{ activeTask.vesselNo }}）{{ activeTask.type }} ·
            {{ activeTask.portName }} {{ activeTask.berthNo }}
          </el-descriptions-item>
          <el-descriptions-item label="拦截原因">
            <div class="reasons">
              <el-tag v-for="reason in activeTask.reasons" :key="reason" size="small" type="danger" effect="plain">
                {{ reason }}
              </el-tag>
            </div>
          </el-descriptions-item>
        </el-descriptions>

        <el-form ref="formRef" :model="reviewForm" :rules="dynamicRules" label-width="90px">
          <el-form-item label="处理人" prop="reviewedBy">
            <el-input id="review-handler" v-model="reviewForm.reviewedBy" placeholder="请输入确认处理人姓名" />
          </el-form-item>
          <el-form-item :label="dialogMode === 'approve' ? '处理备注' : '驳回说明'" prop="note">
            <el-input
              id="review-note"
              v-model="reviewForm.note"
              type="textarea"
              :rows="3"
              :placeholder="dialogMode === 'approve' ? '可填写现场核实说明（选填）' : '请说明驳回原因'"
            />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button
          :type="dialogMode === 'approve' ? 'success' : 'danger'"
          :loading="saving"
          data-testid="submit-review"
          @click="submitDecision"
        >
          {{ dialogMode === 'approve' ? '确认并生成流水' : '确认驳回' }}
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
.filter-card {
  border-radius: 10px;
}
.reasons {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.muted {
  color: #7b8a99;
  font-size: 12px;
  margin-left: 6px;
}
.dialog-alert {
  margin-bottom: 12px;
}
.dialog-desc {
  margin-bottom: 14px;
}
</style>
