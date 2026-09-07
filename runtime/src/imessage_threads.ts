import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CommandRunner } from "./launch.js";
import type { RuntimeConfig } from "./types.js";

const ACTIVE_THREAD_MS = 7 * 24 * 60 * 60_000;
const THREAD_HISTORY_LIMIT = 100;
const IMSG_TIMEOUT_MS = 10_000;
const REACTIONS: Record<string, string> = {
  love: "love",
  like: "like",
  dislike: "dislike",
  laugh: "laugh",
  emphasis: "emphasize",
  question: "question",
};

export interface ThreadOwner {
  routerId: string;
  chatId: string;
}

export interface ThreadRecord extends ThreadOwner {
  id: string;
  chatGuid: string;
  rootGuid: string;
  messageGuid: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  activeUntil: string;
}

export interface RegisterThreadInput {
  messageGuid: string;
  threadRootGuid?: string;
  chatGuid?: string;
  preview: string;
  createdAt?: string;
}

function threadPath(config: RuntimeConfig): string {
  return resolve(config.stateDir, "imessage-threads.jsonl");
}

function loadThreads(config: RuntimeConfig): ThreadRecord[] {
  const path = threadPath(config);
  if (!existsSync(path)) return [];
  const result: ThreadRecord[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      result.push(JSON.parse(line) as ThreadRecord);
    } catch {
      // A malformed historical record is ignored rather than exposed to the router.
    }
  }
  return result;
}

function saveThreads(config: RuntimeConfig, threads: ThreadRecord[]): void {
  const path = threadPath(config);
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const body = threads.map(thread => JSON.stringify(thread)).join("\n") + (threads.length ? "\n" : "");
  writeFileSync(temp, body, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

function validateIdentifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > 512 || /[\0\r\n]/.test(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function preview(value: unknown): string {
  if (typeof value !== "string") throw new Error("thread preview is required");
  return value.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim().slice(0, 160);
}

function resolveChatGuid(config: RuntimeConfig, chatId: string, runner: CommandRunner): string {
  if (!config.imsgPath) throw new Error("targeted iMessage features are not configured");
  const result = runner.run(config.imsgPath, ["group", "--chat-id", chatId, "--json"], { timeoutMs: IMSG_TIMEOUT_MS });
  if (result.status !== 0 || !result.stdout) throw new Error("could not resolve the configured iMessage chat");
  try {
    return validateIdentifier(JSON.parse(result.stdout).guid, "chat GUID");
  } catch {
    throw new Error("could not resolve the configured iMessage chat");
  }
}

function compact(threads: ThreadRecord[], current: Date, taskThreadIds: Set<string>): ThreadRecord[] {
  const sorted = threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const taskThreads = sorted.filter(thread => taskThreadIds.has(thread.id));
  const recent = sorted
    .filter(thread => !taskThreadIds.has(thread.id) && Date.parse(thread.activeUntil) > current.getTime())
    .slice(0, Math.max(0, THREAD_HISTORY_LIMIT - taskThreads.length));
  return [...taskThreads, ...recent].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function registerThread(
  config: RuntimeConfig,
  owner: ThreadOwner,
  input: RegisterThreadInput,
  current: Date,
  runner: CommandRunner,
  taskThreadIds: Set<string> = new Set(),
): ThreadRecord {
  const messageGuid = validateIdentifier(input.messageGuid, "message GUID");
  const rootGuid = validateIdentifier(input.threadRootGuid || messageGuid, "thread root GUID");
  const chatGuid = input.chatGuid
    ? validateIdentifier(input.chatGuid, "chat GUID")
    : resolveChatGuid(config, owner.chatId, runner);
  const threads = loadThreads(config);
  let thread = threads.find(item => item.routerId === owner.routerId && item.chatId === owner.chatId && item.rootGuid === rootGuid);
  if (!thread) {
    thread = {
      id: `thread_${randomBytes(9).toString("base64url")}`,
      ...owner,
      chatGuid,
      rootGuid,
      messageGuid,
      preview: preview(input.preview),
      createdAt: input.createdAt && !Number.isNaN(Date.parse(input.createdAt)) ? new Date(input.createdAt).toISOString() : current.toISOString(),
      updatedAt: current.toISOString(),
      activeUntil: new Date(current.getTime() + ACTIVE_THREAD_MS).toISOString(),
    };
    threads.push(thread);
  } else {
    thread.chatGuid = chatGuid;
    thread.messageGuid = messageGuid;
    thread.preview = preview(input.preview);
    thread.updatedAt = current.toISOString();
    thread.activeUntil = new Date(current.getTime() + ACTIVE_THREAD_MS).toISOString();
  }
  saveThreads(config, compact(threads, current, taskThreadIds));
  return thread;
}

export function activeThreads(config: RuntimeConfig, owner: ThreadOwner, current: Date, taskThreadIds: Set<string>): ThreadRecord[] {
  return loadThreads(config)
    .filter(thread => thread.routerId === owner.routerId && thread.chatId === owner.chatId)
    .filter(thread => Date.parse(thread.activeUntil) > current.getTime() || taskThreadIds.has(thread.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function ownedThread(config: RuntimeConfig, owner: ThreadOwner, threadId: unknown): ThreadRecord {
  const id = validateIdentifier(threadId, "thread ID");
  const thread = loadThreads(config).find(item => item.id === id && item.routerId === owner.routerId && item.chatId === owner.chatId);
  if (!thread) throw new Error("active thread not found for this chat");
  return thread;
}

export function requireActiveThread(config: RuntimeConfig, owner: ThreadOwner, threadId: unknown, current: Date, taskThreadIds: Set<string>): ThreadRecord {
  const thread = ownedThread(config, owner, threadId);
  if (Date.parse(thread.activeUntil) <= current.getTime() && !taskThreadIds.has(thread.id)) {
    throw new Error("active thread not found for this chat");
  }
  return thread;
}

function refreshThread(config: RuntimeConfig, id: string, current: Date, taskThreadIds: Set<string>): void {
  const threads = loadThreads(config);
  const thread = threads.find(item => item.id === id);
  if (!thread) return;
  thread.updatedAt = current.toISOString();
  thread.activeUntil = new Date(current.getTime() + ACTIVE_THREAD_MS).toISOString();
  saveThreads(config, compact(threads, current, taskThreadIds));
}

export function replyToThread(
  config: RuntimeConfig,
  owner: ThreadOwner,
  threadId: unknown,
  text: unknown,
  current: Date,
  runner: CommandRunner,
  taskThreadIds: Set<string>,
): ThreadRecord {
  const thread = requireActiveThread(config, owner, threadId, current, taskThreadIds);
  if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > 16000) {
    throw new Error("reply text is required and must be <= 16000 bytes");
  }
  if (!config.imsgPath) throw new Error("targeted iMessage features are not configured");
  const result = runner.run(config.imsgPath, [
    "send-rich",
    "--chat", thread.chatGuid,
    "--text", text,
    "--reply-to", thread.rootGuid,
    "--json",
  ], { timeoutMs: IMSG_TIMEOUT_MS });
  if (result.status !== 0) throw new Error("targeted iMessage replies are unavailable; the advanced imsg bridge may not be enabled");
  refreshThread(config, thread.id, current, taskThreadIds);
  return thread;
}

export function reactToThread(
  config: RuntimeConfig,
  owner: ThreadOwner,
  threadId: unknown,
  reaction: unknown,
  current: Date,
  runner: CommandRunner,
  taskThreadIds: Set<string>,
): ThreadRecord {
  const thread = requireActiveThread(config, owner, threadId, current, taskThreadIds);
  if (typeof reaction !== "string" || !REACTIONS[reaction]) throw new Error("reaction must be love, like, dislike, laugh, emphasis, or question");
  if (!config.imsgPath) throw new Error("targeted iMessage features are not configured");
  const result = runner.run(config.imsgPath, [
    "tapback",
    "--chat", thread.chatGuid,
    "--message", thread.messageGuid,
    "--kind", REACTIONS[reaction],
    "--part", "0",
    "--json",
  ], { timeoutMs: IMSG_TIMEOUT_MS });
  if (result.status !== 0) throw new Error("targeted iMessage reactions are unavailable; the advanced imsg bridge may not be enabled");
  refreshThread(config, thread.id, current, taskThreadIds);
  return thread;
}
