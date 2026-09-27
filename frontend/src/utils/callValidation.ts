import type { Berth } from '../types/berth';
import type { CallDraft } from '../types/call';
import type { FishingPort } from '../types/port';
import type { FishingVessel } from '../types/vessel';
import type { ReviewIssue } from '../types/review';

export interface CallValidationResult {
  issues: ReviewIssue[];
  valid: boolean;
}

function isCertificateExpired(expiry: string, at: string): boolean {
  const endOfExpiryDay = new Date(`${expiry}T23:59:59`).getTime();
  if (Number.isNaN(endOfExpiryDay)) return true;
  const eventTime = new Date(at).getTime();
  return (Number.isNaN(eventTime) ? Date.now() : eventTime) > endOfExpiryDay;
}

/**
 * 提交进出港登记时执行的统一核验：证书、吃水、重号船与泊位条件。
 * 任何一项不通过都只生成待办，不直接写入正常流水或改变泊位。
 */
export function validateCallRegistration(input: {
  draft: CallDraft;
  vessel: FishingVessel;
  vessels: FishingVessel[];
  port: FishingPort;
  berth?: Berth;
  at?: string;
}): CallValidationResult {
  const { draft, vessel, vessels, port, berth } = input;
  const issues: ReviewIssue[] = [];
  const eventTime = draft.time || input.at || new Date().toISOString();

  if (isCertificateExpired(vessel.certificateExpiry, eventTime)) {
    issues.push({
      code: 'certificate_expired',
      message: `在${port.name}核验：渔船证书已于 ${vessel.certificateExpiry} 过期`,
    });
  }

  if (!berth) {
    issues.push({
      code: 'berth_unavailable',
      message: `在${port.name}核验：泊位 ${draft.berthNo} 不存在`,
    });
  }

  if (berth && Number(vessel.draftDepth) > Number(berth.designDepth)) {
    issues.push({
      code: 'draft_too_deep',
      message: `在${port.name}核验：渔船吃水 ${Number(vessel.draftDepth).toFixed(1)}m 超过泊位 ${berth.berthNo} 水深 ${Number(berth.designDepth).toFixed(1)}m`,
    });
  }

  const normalizedNo = vessel.vesselNo.trim().toUpperCase();
  const duplicateVessels = vessels.filter(
    (item) => item.id !== vessel.id && item.vesselNo.trim().toUpperCase() === normalizedNo,
  );
  if (duplicateVessels.length > 0) {
    const names = duplicateVessels.map((item) => item.name).join('、');
    issues.push({
      code: 'duplicate_vessel_no',
      message: `在${port.name}核验：渔船编号 ${normalizedNo} 重号，已被 ${names} 使用`,
    });
  }

  if (berth) {
    if (draft.type === '进港' && berth.status !== '空闲') {
      const occupant = berth.vesselName ? `，当前由 ${berth.vesselName} 占用` : '';
      issues.push({
        code: 'berth_unavailable',
        message: `在${port.name}核验：泊位 ${berth.berthNo} 当前为「${berth.status}」${occupant}，不能进港靠泊`,
      });
    }
    if (draft.type === '出港') {
      if (berth.status !== '占用') {
        issues.push({
          code: 'berth_unavailable',
          message: `在${port.name}核验：泊位 ${berth.berthNo} 当前为「${berth.status}」，没有可办理出港的占用记录`,
        });
      } else if (berth.vesselId && berth.vesselId !== vessel.id) {
        issues.push({
          code: 'berth_unavailable',
          message: `在${port.name}核验：泊位 ${berth.berthNo} 当前由 ${berth.vesselName ?? '其他渔船'} 占用，不能为 ${vessel.name} 办理出港`,
        });
      }
    }
  }

  return { issues, valid: issues.length === 0 };
}
