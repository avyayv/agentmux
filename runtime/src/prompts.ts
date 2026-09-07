import type { SensitiveAction } from "./types.js";

const WORKER_INTRO = "You are a visible Context Drop task worker. Report naturally with the context-drop report command whenever you start, make meaningful progress, finish, fail, or need user input. The command accepts a plain-language message; do not invent a status taxonomy or visibility prefix. Proceed autonomously through routine implementation, testing, debugging, retries, and reversible choices. Do not ask for permission or confirmation mid-task when a safe reasonable default exists. Ask only when genuinely blocked by missing information or when an irreversible or high-impact action cannot safely be inferred.";

const SCHEDULED_WORKER_INTRO = "You are a Context Drop scheduled worker. Follow TASK exactly. Do not send routine start, progress, or successful-completion reports. Every context-drop report from a scheduled worker is delivered verbatim to the user's private chat, so send one only when TASK explicitly requires a user-facing Context Drop report or when a concise blocker or failure must reach the user. If TASK sends its own user notification with another messaging tool, do not duplicate it through context-drop report. After a successful direct delivery, finish silently.";

const WORKTREE_POLICY = "WORKTREE POLICY: Before editing code, inspect the repository instructions and current checkout. When the task requires a new worktree, use gwts and do all subsequent work in the worktree path it returns (normally under ~/.avyay-worktrees). Never substitute a sibling directory, copied checkout, clone, or raw git worktree add. If gwts is unavailable, report that blocker instead of improvising a different location.";
export interface WorkerAuthorization {
  id: string;
  action: SensitiveAction;
  scope: string;
  expiresAt: string;
}

export function workerPrompt(task: string, _authorization?: WorkerAuthorization): string {
  return `${WORKER_INTRO}\n\nTASK:\n${task}`;
}

export function scheduledWorkerPrompt(task: string): string {
  return `${SCHEDULED_WORKER_INTRO}\n\nTASK:\n${task}`;
}
