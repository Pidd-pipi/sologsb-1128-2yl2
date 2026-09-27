import type { CallDraft, CallType } from './call';

/** 进出港核验问题类型 */
export type ReviewIssueCode =
  | 'certificate_expired'
  | 'draft_too_deep'
  | 'duplicate_vessel_no'
  | 'berth_unavailable';

/** 核验发现的问题 */
export interface ReviewIssue {
  code: ReviewIssueCode;
  /** 可直接展示的问题说明，已包含涉及渔港 */
  message: string;
}

/** 核验待办状态 */
export type ReviewStatus = '待处理' | '已放行' | '已驳回';

export const REVIEW_STATUSES: ReviewStatus[] = ['待处理', '已放行', '已驳回'];

/** 进出港核验待办 */
export interface CallReviewTask {
  id: string;
  /** 渔船 id */
  vesselId: string;
  vesselName: string;
  vesselNo: string;
  /** 涉及渔港 id */
  portId: string;
  portName: string;
  berthNo: string;
  type: CallType;
  /** 申报时渔船吃水快照 m */
  draftDepth: number | null;
  /** 申报时泊位设计水深快照 m */
  berthDepth: number | null;
  /** 申报时证书有效期快照 */
  certificateExpiry: string;
  /** 待核验的进出港申请表单 */
  draft: CallDraft;
  /** 核验问题（与 reasons 保持同源，便于后续按类型处理） */
  issues: ReviewIssue[];
  /** 问题原因说明 */
  reasons: string[];
  status: ReviewStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  /** 放行后生成的正常流水 id */
  resolvedCallId?: string;
}
