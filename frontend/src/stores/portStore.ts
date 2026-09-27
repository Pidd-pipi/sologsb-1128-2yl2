import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../db';
import { toPlain, uid } from '../utils/format';
import { emptyPortFilter, type FishingPort, type PortFilter, type SupplyCapability } from '../types/port';
import type { Berth, BerthStatus } from '../types/berth';
import type { CallDraft, PortCall } from '../types/call';
import type { FishingVessel } from '../types/vessel';
import type { ReviewTask } from '../types/review';
import { verifyCall } from '../utils/verify';
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

/** 提交进出港登记的结果：核验通过直接写流水，否则生成待办 */
export type SubmitCallResult = { kind: 'ok'; call: PortCall } | { kind: 'review'; task: ReviewTask };

export const usePortStore = defineStore('port', () => {
  const ports = ref<FishingPort[]>([]);
  const berths = ref<Berth[]>([]);
  const calls = ref<PortCall[]>([]);
  const reviews = ref<ReviewTask[]>([]);
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

  /** 待办按申报时间倒序 */
  const reviewsSorted = computed(() =>
    [...reviews.value].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
  );

  const pendingReviews = computed(() => reviewsSorted.value.filter((r) => r.status === '待处理'));

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

  /**
   * 登记一条进出港记录，并同步泊位占用状态（进港 → 占用，出港 → 释放）。
   * 仅供核验通过或待办放行后调用；常规提交请走 submitCall。
   */
  async function registerCall(draft: CallDraft, vesselName: string, portId: string): Promise<PortCall> {
    const call: PortCall = {
      id: uid('c'),
      vesselId: draft.vesselId,
      vesselName,
      type: draft.type,
      time: draft.time ? new Date(draft.time).toISOString() : new Date().toISOString(),
      berthNo: draft.berthNo,
      iceKg: Number(draft.iceKg) || 0,
      fuelL: Number(draft.fuelL) || 0,
      unloadKg: Number(draft.unloadKg) || 0,
      visaStatus: draft.visaStatus,
      createdAt: new Date().toISOString(),
    };
    await db.calls.put(toPlain(call));
    calls.value = [...calls.value, call];

    const berth = berths.value.find((b) => b.portId === portId && b.berthNo === draft.berthNo);
    if (berth) {
      const next: Berth =
        draft.type === '进港'
          ? {
              ...berth,
              status: '占用',
              vesselId: draft.vesselId,
              vesselName,
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
      await db.berths.put(toPlain(next));
      berths.value = berths.value.map((b) => (b.id === berth.id ? next : b));
    }
    return call;
  }

  /**
   * 提交进出港登记：先核对证书、吃水、泊位条件与重号船。
   * 核验通过 → 写正常流水；未通过 → 生成待办（写明原因与涉及渔港），不写流水、不动泊位。
   */
  async function submitCall(draft: CallDraft, vessel: FishingVessel, portId: string): Promise<SubmitCallResult> {
    const port = portById(portId);
    const berth = berths.value.find((b) => b.portId === portId && b.berthNo === draft.berthNo);
    const allVessels = await db.vessels.toArray();
    const issues = verifyCall({ vessel, berth, port, type: draft.type, vessels: allVessels });

    if (issues.length === 0) {
      const call = await registerCall(draft, vessel.name, portId);
      return { kind: 'ok', call };
    }

    const task: ReviewTask = {
      id: uid('r'),
      vesselId: vessel.id,
      vesselName: vessel.name,
      vesselNo: vessel.vesselNo,
      portId,
      portName: port?.name ?? portId,
      berthNo: draft.berthNo,
      type: draft.type,
      time: draft.time ? new Date(draft.time).toISOString() : new Date().toISOString(),
      issues,
      payload: toPlain(draft),
      status: '待处理',
      handler: '',
      handledAt: null,
      note: '',
      createdAt: new Date().toISOString(),
    };
    await db.reviews.put(toPlain(task));
    reviews.value = [...reviews.value, task];
    return { kind: 'review', task };
  }

  /**
   * 待办放行：处理人确认后把原始登记内容转成正常流水（同步泊位），待办标记为已放行。
   */
  async function confirmReview(taskId: string, handler: string, note: string): Promise<PortCall | null> {
    const task = reviews.value.find((r) => r.id === taskId);
    if (!task || task.status !== '待处理') return null;
    const call = await registerCall(task.payload, task.vesselName, task.portId);
    const next: ReviewTask = {
      ...task,
      status: '已放行',
      handler: handler.trim(),
      handledAt: new Date().toISOString(),
      note: note.trim(),
    };
    await db.reviews.put(toPlain(next));
    reviews.value = reviews.value.map((r) => (r.id === taskId ? next : r));
    return call;
  }

  /** 待办驳回：不写流水，仅留痕处理人、时间与备注 */
  async function rejectReview(taskId: string, handler: string, note: string): Promise<void> {
    const task = reviews.value.find((r) => r.id === taskId);
    if (!task || task.status !== '待处理') return;
    const next: ReviewTask = {
      ...task,
      status: '已驳回',
      handler: handler.trim(),
      handledAt: new Date().toISOString(),
      note: note.trim(),
    };
    await db.reviews.put(toPlain(next));
    reviews.value = reviews.value.map((r) => (r.id === taskId ? next : r));
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
    registerCall,
    submitCall,
    confirmReview,
    rejectReview,
  };
});
