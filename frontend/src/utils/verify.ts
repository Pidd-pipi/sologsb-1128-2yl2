import type { Berth } from '../types/berth';
import type { FishingPort } from '../types/port';
import type { FishingVessel } from '../types/vessel';
import type { CallType } from '../types/call';
import type { ReviewIssue, ReviewIssueCode } from '../types/review';
import { daysUntilExpiry } from './tonnage';
import { formatNumber } from './format';

/** 进出港核验入参 */
export interface VerifyInput {
  vessel: FishingVessel;
  /** 申报泊位（可能查不到记录） */
  berth: Berth | undefined;
  /** 涉及渔港 */
  port: FishingPort | undefined;
  type: CallType;
  /** 全部渔船档案（用于重号核对） */
  vessels: FishingVessel[];
}

/** 老档案（v4 迁移前）未登记吃水时的默认吃水 m */
export const DEFAULT_DRAFT = 3;

/** 读取渔船吃水，老档案缺字段时回退默认值 */
export function vesselDraft(vessel: FishingVessel): number {
  const draft = Number(vessel.draft);
  return Number.isFinite(draft) && draft > 0 ? draft : DEFAULT_DRAFT;
}

/**
 * 进出港核验：核对证书有效期、吃水与泊位水深、泊位状态与重号船。
 * 返回空数组表示核验通过，可直接写流水；否则应进入待办。
 */
export function verifyCall(input: VerifyInput): ReviewIssue[] {
  const { vessel, berth, port, type, vessels } = input;
  const issues: ReviewIssue[] = [];

  // 1. 证书有效期
  const days = daysUntilExpiry(vessel.certificateExpiry);
  if (Number.isNaN(days)) {
    issues.push({ code: '证书过期', detail: `证书有效期「${vessel.certificateExpiry}」无法识别` });
  } else if (days < 0) {
    issues.push({
      code: '证书过期',
      detail: `证书已于 ${vessel.certificateExpiry} 过期（已过期 ${Math.abs(days)} 天）`,
    });
  }

  // 2. 重号船：同一渔船编号挂在多份档案上
  const duplicates = vessels.filter((v) => v.vesselNo === vessel.vesselNo && v.id !== vessel.id);
  if (duplicates.length > 0) {
    const names = duplicates.map((v) => `「${v.name}」`).join('、');
    issues.push({ code: '编号重复', detail: `编号 ${vessel.vesselNo} 与 ${names} 重复` });
  }

  // 3. 泊位条件 + 吃水
  if (!berth) {
    issues.push({ code: '泊位不可用', detail: '未找到对应泊位记录，请核对泊位号' });
  } else if (type === '进港') {
    if (berth.status !== '空闲') {
      const extra = berth.status === '占用' && berth.vesselName ? `（现由 ${berth.vesselName} 使用）` : '';
      issues.push({ code: '泊位不可用', detail: `泊位 ${berth.berthNo} 当前为「${berth.status}」${extra}` });
    }
    const draft = vesselDraft(vessel);
    if (draft > berth.designDepth) {
      issues.push({
        code: '吃水超限',
        detail: `吃水 ${formatNumber(draft)}m 超过泊位 ${berth.berthNo} 设计水深 ${formatNumber(berth.designDepth)}m`,
      });
    }
  } else {
    if (berth.status !== '占用' || berth.vesselId !== vessel.id) {
      issues.push({ code: '泊位不可用', detail: `泊位 ${berth.berthNo} 未记录该船靠泊，无法办理出港` });
    }
  }

  // 4. 渔港档案缺失（兜底，正常流程选不到）
  if (!port) {
    issues.push({ code: '泊位不可用', detail: '未找到涉及渔港档案' });
  }

  return issues;
}

/** 问题编码 → 标签颜色（待办列表 / 登记预检共用） */
export function issueTagType(code: ReviewIssueCode): 'danger' | 'warning' | 'info' {
  if (code === '证书过期' || code === '吃水超限') return 'danger';
  if (code === '编号重复') return 'warning';
  return 'info';
}
