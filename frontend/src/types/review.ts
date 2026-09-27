import type { CallDraft, CallType } from './call';

/** 核验问题编码 */
export type ReviewIssueCode = '证书过期' | '吃水超限' | '泊位不可用' | '编号重复';

/** 一条核验问题（原因明细） */
export interface ReviewIssue {
  code: ReviewIssueCode;
  /** 问题明细，如「吃水 4.2m 超过泊位 B03 设计水深 3.9m」 */
  detail: string;
}

/** 待办处理状态 */
export type ReviewStatus = '待处理' | '已放行' | '已驳回';

export const REVIEW_STATUSES: ReviewStatus[] = ['待处理', '已放行', '已驳回'];

/**
 * 进出港核验待办：登记核验未通过时先生成待办（不写流水），
 * 处理人确认放行后才把 payload 转成正常进出港流水。
 */
export interface ReviewTask {
  id: string;
  /** 渔船 id */
  vesselId: string;
  /** 渔船名（冗余，便于待办列表展示） */
  vesselName: string;
  /** 渔船编号（冗余，便于核对重号） */
  vesselNo: string;
  /** 涉及渔港 id */
  portId: string;
  /** 涉及渔港名称（冗余） */
  portName: string;
  /** 泊位号 */
  berthNo: string;
  /** 类型：进港 / 出港 */
  type: CallType;
  /** 申报时间（ISO 字符串） */
  time: string;
  /** 核验未通过的原因列表 */
  issues: ReviewIssue[];
  /** 原始登记内容，放行时原样转流水 */
  payload: CallDraft;
  /** 处理状态 */
  status: ReviewStatus;
  /** 处理人（待处理时为空） */
  handler: string;
  /** 处理时间（ISO 字符串，待处理时为 null） */
  handledAt: string | null;
  /** 处理备注 */
  note: string;
  createdAt: string;
}
