import type { SensitiveAction } from "./types.js";

const WORKER_INTRO = "You are a visible Context Drop task worker. Report naturally with the context-drop report command whenever you start, make meaningful progress, finish, fail, or need user input. The command accepts a plain-language message; do not invent a status taxonomy or visibility prefix. Proceed autonomously through routine implementation, testing, debugging, retries, and reversible choices. Do not ask for permission or confirmation mid-task when a safe reasonable default exists. Ask only when genuinely blocked by missing information or when an irreversible or high-impact action cannot safely be inferred.";

export interface WorkerAuthorization {
  id: string;
  action: SensitiveAction;
  scope: string;
  expiresAt: string;
}

export function workerPrompt(task: string, _authorization?: WorkerAuthorization): string {
  return `${WORKER_INTRO}\n\nTASK:\n${task}`;
}

export function continuationPrompt(message: string): string {
  return `Context Drop follow-up:\n${message}\n\nRemember to report progress or completion with: context-drop report "message"`;
}
