package orchestrator

import (
	"fmt"
	"testing"
	"time"
)

func TestMessageRetentionPreservesUnfinishedWork(t *testing.T) {
	st := State{MessageJobs: map[string]MessageJob{}}
	for _, status := range []string{"queued", "processing", "unknown"} {
		st.MessageJobs[status] = MessageJob{MessageID: status, Status: status, UpdatedAt: time.Unix(1, 0)}
	}
	for i := 0; i < MaxMessageJobs+10; i++ {
		id := fmt.Sprint(i)
		st.MessageJobs[id] = MessageJob{MessageID: id, Status: "sent", UpdatedAt: time.Unix(int64(i+2), 0)}
	}
	pruneState(&st)
	if len(st.MessageJobs) != MaxMessageJobs {
		t.Fatalf("retained %d jobs", len(st.MessageJobs))
	}
	for _, status := range []string{"queued", "processing", "unknown"} {
		if st.MessageJobs[status].Status != status {
			t.Fatalf("lost %s job", status)
		}
	}
}
