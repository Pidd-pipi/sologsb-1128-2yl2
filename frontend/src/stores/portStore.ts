import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../db';
import { toPlain, uid } from '../utils/format';
import { emptyPortFilter, type FishingPort, type PortFilter, type SupplyCapability } from '../types/port';
import type { Berth, BerthStatus } from '../types/berth';
import type { CallDraft, PortCall } from '../types/call';
import type { FishingVessel } from '../types/vessel';
import type { CallReviewTask } from '../types/review';
import { validateCallRegistration } from '../utils/callValidation';
import { buildBerthRecords } from '../db/berth';

export interface PortInput {
  name: string;
  level: FishingPort['level'];
  longitude: number;
  latitude: number;
  berthCount: number;
  berthDepth: number;
  wharfLength: number;
  shelterLevel: number;
  supply: SupplyCapability;
  manager: string;
}

export type CallSubmissionResult =
  | { outcome: 'registered'; call: PortCall }
  | { outcome: 'review'; review: CallReviewTask };

export const usePortStore = defineStore('port', () => {
  const ports = ref<FishingPort[]>([]);
  const berths = ref<Berth[]>([]);
  const calls = ref<PortCall[]>([]);
  const reviews = ref<CallReviewTask[]>([]);
  const loading = ref(false);
  const filter = ref<PortFilter>(emptyPortFilter());

  const filteredPorts = computed(() => {
    const f = filter.value;
    const keyword = f.keyword.trim();
    return ports.value.filter((p) => {
      if (f.level && p.level !== f.level) return false;
      if (f.minShelterLevel !== null && p.shelterLevel < f.minShelterLevel) return false;
      if (keyword && !p.name.includes(keyword) && !p.manager.includes(keyword)) return false;
      return true;
    });
  });

  const callsSorted = computed(() =>
    [...calls.value].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
  );

  const reviewsSorted = computed(() =>
    [...reviews.value].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  );
  const pendingReviews = computed(() => reviewsSorted.value.filter((item) => item.status === '待处理'));
  const pendingReviewCount = computed(() => pendingReviews.value.length);

  function portById(id: string): FishingPort | undefined {
    return ports.value.find((p) => p.id === id);
  }

  function berthsOf(portId: string): Berth[] {
    return berths.value.filter((b) => b.portId === portId).sort((a, b) => a.berthNo.localeCompare(b.berthNo));
  }

  function callsOfVessel(vesselId: string): PortCall[] {
    return callsSorted.value.filter((c) => c.vesselId === vesselId);
  }

  function resetFilter(): void {
    filter.value = emptyPortFilter();
  }

  async function loadAll(): Promise<void> {
    loading.value = true;
    try {
      const [p, b, c, r] = await Promise.all([
        db.ports.toArray(),
        db.berths.toArray(),
        db.calls.toArray(),
        db.reviews.toArray(),
      ]);
      ports.value = p;
      berths.value = b;
      calls.value = c;
      reviews.value = r;
    } finally {
      loading.value = false;
    }
  }

  async function createPort(input: PortInput): Promise<FishingPort> {
    const port: FishingPort = {
      id: uid('p'),
      name: input.name.trim(),
      level: input.level,
      longitude: Number(input.longitude),
      latitude: Number(input.latitude),
      berthCount: Number(input.berthCount),
      berthDepth: Number(input.berthDepth),
      wharfLength: Number(input.wharfLength),
      shelterLevel: Number(input.shelterLevel),
      supply: { ...input.supply },
      manager: input.manager.trim(),
      createdAt: new Date().toISOString(),
    };
    // 写库前脱代理，避免 DataCloneError
    await db.ports.put(toPlain(port));
    const records = buildBerthRecords(port, []);
    await db.berths.bulkPut(toPlain(records));
    ports.value = [...ports.value, port];
    berths.value = [...berths.value, ...records];
    return port;
  }

  async function addBerth(portId: string, berthNo: string, designDepth: number): Promise<Berth | null> {
    const port = portById(portId);
    if (!port) return null;
    const no = berthNo.trim().toUpperCase();
    if (!no) return null;
    if (berthsOf(portId).some((b) => b.berthNo === no)) return null;
    const berth: Berth = {
      id: `${portId}-${no}`,
      portId,
      berthNo: no,
      vesselId: null,
      vesselName: null,
      berthAt: null,
      leaveAt: null,
      status: '空闲',
      designDepth: Number(designDepth) || port.berthDepth,
    };
    await db.berths.put(toPlain(berth));
    berths.value = [...berths.value, berth];
    const nextCount = berthsOf(portId).length;
    await updatePort(portId, { berthCount: nextCount });
    return berth;
  }

  async function setBerthStatus(berthId: string, status: BerthStatus): Promise<void> {
    const hit = berths.value.find((b) => b.id === berthId);
    if (!hit) return;
    const next: Berth = {
      ...hit,
      status,
      vesselId: status === '占用' ? hit.vesselId : null,
      vesselName: status === '占用' ? hit.vesselName : null,
      berthAt: status === '占用' ? hit.berthAt ?? new Date().toISOString() : hit.berthAt,
      leaveAt: status === '空闲' ? new Date().toISOString() : null,
    };
    await db.berths.put(toPlain(next));
    berths.value = berths.value.map((b) => (b.id === berthId ? next : b));
  }

  async function updatePort(portId: string, patch: Partial<FishingPort>): Promise<void> {
    const hit = portById(portId);
    if (!hit) return;
    const next: FishingPort = { ...hit, ...patch };
    await db.ports.put(toPlain(next));
    ports.value = ports.value.map((p) => (p.id === portId ? next : p));
  }

  function applyCallToBerth(draft: CallDraft, portId: string, vessel: FishingVessel, call: PortCall): Berth | null {
    const berth = berths.value.find((b) => b.portId === portId && b.berthNo === draft.berthNo);
    if (!berth) return null;
    const next: Berth =
      draft.type === '进港'
        ? {
            ...berth,
            status: '占用',
            vesselId: vessel.id,
            vesselName: vessel.name,
            berthAt: call.time,
            leaveAt: null,
          }
        : {
            ...berth,
            status: '空闲',
            vesselId: null,
            vesselName: null,
            berthAt: null,
            leaveAt: call.time,
          };
    berths.value = berths.value.map((b) => (b.id === berth.id ? next : b));
    return next;
  }

  async function writeCallAndSyncBerth(draft: CallDraft, portId: string, vessel: FishingVessel): Promise<PortCall> {
    const call: PortCall = {
      id: uid('c'),
      vesselId: vessel.id,
      vesselName: vessel.name,
      type: draft.type,
      time: draft.time ? new Date(draft.time).toISOString() : new Date().toISOString(),
      berthNo: draft.berthNo,
      portId,
      iceKg: Number(draft.iceKg) || 0,
      fuelL: Number(draft.fuelL) || 0,
      unloadKg: Number(draft.unloadKg) || 0,
      visaStatus: draft.visaStatus,
      createdAt: new Date().toISOString(),
    };
    await db.calls.put(toPlain(call));
    calls.value = [...calls.value, call];

    const nextBerth = applyCallToBerth(draft, portId, vessel, call);
    if (nextBerth) await db.berths.put(toPlain(nextBerth));
    return call;
  }

  /**
   * 提交进出港登记：先核验证书、吃水、重号船与泊位条件。
   * 核验不通过时只写待办，不产生正常流水、不改变泊位；待处理人确认放行后才落流水。
   */
  async function submitCallRegistration(draft: CallDraft, vessel: FishingVessel, allVessels: FishingVessel[]): Promise<CallSubmissionResult> {
    const portId = draft.portId ?? '';
    const port = portById(portId);
    if (!port) throw new Error('请选择有效的渔港泊位');
    const normalizedDraft: CallDraft = { ...draft, portId, berthNo: draft.berthNo.trim().toUpperCase() };
    const berth = berths.value.find((b) => b.portId === portId && b.berthNo === normalizedDraft.berthNo);
    const result = validateCallRegistration({
      draft: normalizedDraft,
      vessel,
      vessels: allVessels,
      port,
      berth,
    });

    if (result.issues.length > 0) {
      const review: CallReviewTask = {
        id: uid('r'),
        vesselId: vessel.id,
        vesselName: vessel.name,
        vesselNo: vessel.vesselNo,
        portId: port.id,
        portName: port.name,
        berthNo: normalizedDraft.berthNo,
        type: normalizedDraft.type,
        draftDepth: Number(vessel.draftDepth),
        berthDepth: berth ? Number(berth.designDepth) : null,
        certificateExpiry: vessel.certificateExpiry,
        draft: toPlain(normalizedDraft),
        issues: toPlain(result.issues),
        reasons: result.issues.map((issue) => issue.message),
        status: '待处理',
        createdAt: new Date().toISOString(),
      };
      await db.reviews.put(toPlain(review));
      reviews.value = [...reviews.value, review];
      return { outcome: 'review', review };
    }

    const call = await writeCallAndSyncBerth(normalizedDraft, portId, vessel);
    return { outcome: 'registered', call };
  }

  /** 处理人确认放行；若档案或泊位已修正，会按最新数据重新核验。 */
  async function approveReview(
    reviewId: string,
    reviewedBy: string,
    allVessels: FishingVessel[],
    reviewNote = '',
  ): Promise<PortCall> {
    const task = reviews.value.find((item) => item.id === reviewId);
    if (!task) throw new Error('待办不存在或已被处理');
    if (task.status !== '待处理') throw new Error('该待办已处理');

    const vessel = allVessels.find((item) => item.id === task.vesselId);
    if (!vessel) throw new Error('渔船档案不存在，无法放行');
    const port = portById(task.portId);
    if (!port) throw new Error('涉及渔港不存在，无法放行');
    const berth = berths.value.find((b) => b.portId === task.portId && b.berthNo === task.draft.berthNo);
    const result = validateCallRegistration({
      draft: task.draft,
      vessel,
      vessels: allVessels,
      port,
      berth,
    });
    const blockingIssues = result.issues.filter((issue) => issue.code === 'berth_unavailable');
    if (blockingIssues.length > 0) {
      throw new Error(`泊位条件仍不满足：${blockingIssues.map((issue) => issue.message).join('；')}`);
    }

    const call = await writeCallAndSyncBerth({ ...task.draft, portId: task.portId }, task.portId, vessel);
    const reviewedAt = new Date().toISOString();
    const next: CallReviewTask = {
      ...task,
      status: '已放行',
      reviewedAt,
      reviewedBy: reviewedBy.trim(),
      reviewNote: reviewNote.trim() || undefined,
      resolvedCallId: call.id,
    };
    await db.reviews.put(toPlain(next));
    reviews.value = reviews.value.map((item) => (item.id === task.id ? next : item));
    return call;
  }

  async function rejectReview(reviewId: string, reviewedBy: string, note: string): Promise<void> {
    const task = reviews.value.find((item) => item.id === reviewId);
    if (!task) throw new Error('待办不存在或已被处理');
    if (task.status !== '待处理') throw new Error('该待办已处理');
    const next: CallReviewTask = {
      ...task,
      status: '已驳回',
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewedBy.trim(),
      reviewNote: note.trim(),
    };
    await db.reviews.put(toPlain(next));
    reviews.value = reviews.value.map((item) => (item.id === task.id ? next : item));
  }

  return {
    ports,
    berths,
    calls,
    reviews,
    loading,
    filter,
    filteredPorts,
    callsSorted,
    reviewsSorted,
    pendingReviews,
    pendingReviewCount,
    portById,
    berthsOf,
    callsOfVessel,
    resetFilter,
    loadAll,
    createPort,
    addBerth,
    setBerthStatus,
    updatePort,
    submitCallRegistration,
    approveReview,
    rejectReview,
  };
});
