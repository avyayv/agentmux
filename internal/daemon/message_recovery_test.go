package daemon

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"contextdrop.dev/context-drop/internal/imessage"
	"contextdrop.dev/context-drop/internal/orchestrator"
)

func TestProcessingDoesNotExecuteWithoutDurableState(t *testing.T) {
	commander := &messageCommander{}
	runner := &Runner{Store: orchestrator.Store{Path: t.TempDir()}, Now: time.Now, IMessage: &imessage.Adapter{Config: messageTestConfig(t), Commander: commander}}
	runner.processMessage(context.Background(), imessage.Message{ID: "1", Text: "hello", ChatID: "1"})
	if commander.responds != 0 || len(commander.sends) != 0 {
		t.Fatal("executed a turn despite failed state transition")
	}
}

func TestRecoverMessagesReplaysOnlyDurablyQueuedInput(t *testing.T) {
	store := orchestrator.Store{Path: filepath.Join(t.TempDir(), "state.json")}
	now := time.Now().UTC()
	err := store.Update(func(st *orchestrator.State) error {
		st.IMessageChatID = "1"
		st.IMessageInitialized = true
		st.MessageJobs["queued"] = orchestrator.MessageJob{MessageID: "queued", Status: "queued", ClaimedAt: now, Input: &orchestrator.MessageInput{Text: "hello", ChatID: "1"}}
		st.MessageJobs["interrupted"] = orchestrator.MessageJob{MessageID: "interrupted", Status: "processing", ClaimedAt: now, Input: &orchestrator.MessageInput{Text: "do not repeat", ChatID: "1"}}
		st.MessageJobs["legacy"] = orchestrator.MessageJob{MessageID: "legacy", Status: "queued", ClaimedAt: now}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := &Runner{Store: store, Now: func() time.Time { return now }, IMessage: &imessage.Adapter{Config: messageTestConfig(t), Commander: &messageCommander{}}}
	if err := runner.recoverMessages(ctx); err != nil {
		t.Fatal(err)
	}
	waitForMessageJobs(t, store, "queued")
	st, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"interrupted", "legacy"} {
		if st.MessageJobs[id].Status != "unknown" {
			t.Fatalf("%s status=%s", id, st.MessageJobs[id].Status)
		}
	}
	if st.MessageJobs["queued"].Input != nil {
		t.Fatal("completed input retained")
	}
}
