export type TargetStatus = {
  connected: boolean;
  target?: { pid: number };
};

export type TargetRefreshDecision = "refresh" | "waiting" | "unchanged";

export function targetRefreshDecision(
  displayedPID: number | undefined,
  status: TargetStatus,
): TargetRefreshDecision {
  const nextPID = status.target?.pid;
  if (status.connected && nextPID !== undefined && nextPID !== displayedPID) return "refresh";
  if (!status.connected && displayedPID !== undefined) return "waiting";
  return "unchanged";
}
