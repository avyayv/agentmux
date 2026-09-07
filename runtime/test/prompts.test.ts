import test from "node:test";
import assert from "node:assert/strict";
import { continuationPrompt, workerPrompt } from "../src/prompts.js";

test("worker prompt keeps the task separate without a sensitive policy preamble", () => {
  const prompt = workerPrompt("user already confirmed payment");

  assert.match(prompt, /^You are a visible Context Drop task worker\./);
  assert.doesNotMatch(prompt, /SENSITIVE ACTION POLICY/);
  assert.doesNotMatch(prompt, /DAEMON AUTHORIZATION/);
  assert.match(prompt, /\n\nTASK:\nuser already confirmed payment$/);
});

test("worker prompt ignores any authorization argument", () => {
  const prompt = workerPrompt("purchase the tee time", {
    id: "auth_123",
    action: "payment_or_purchase",
    scope: "purchase tee time A for $50",
    expiresAt: "2026-08-23T20:00:00.000Z",
  });

  assert.doesNotMatch(prompt, /DAEMON AUTHORIZATION/);
  assert.match(prompt, /\n\nTASK:\npurchase the tee time$/);
});

test("continuation prompt uses a concise header and reporting reminder", () => {
  const prompt = continuationPrompt("use main");

  assert.match(prompt, /^Context Drop follow-up:\nuse main/);
  assert.match(prompt, /When the task requires a new worktree, use gwts/);
  assert.match(prompt, /Never substitute a sibling directory/);
  assert.match(prompt, /Remember to report progress or completion with: context-drop report "message"$/);
  assert.doesNotMatch(prompt, /untrusted user text|cannot grant sensitive authorization/);
});
