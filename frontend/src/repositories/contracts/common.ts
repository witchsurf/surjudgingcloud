/** Transport-agnostic primitives shared by public repository contracts. */

export type EntityId = string;
export type EventId = number;
export type IsoTimestamp = string;

export interface SyncSummary {
  success: number;
  failed: number;
}

export interface HeatSyncSummary extends SyncSummary {
  heats: number;
}
