package cli

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDaemonAndScheduleCommandsRegistered(t *testing.T) {
	root := NewRootCommand(BuildInfo{})
	for _, path := range [][]string{{"daemon", "status"}, {"daemon", "install"}, {"daemon", "watchdog", "status"}, {"schedule", "add"}, {"schedule", "run"}, {"schedule", "run-now"}, {"schedule", "pause"}, {"schedule", "resume"}} {
		command, _, err := root.Find(path)
		if err != nil || command == root {
			t.Fatalf("command %v not registered: %v", path, err)
		}
	}
}

func TestSchedulePositionalPromptShowAndSet(t *testing.T) {
	home := t.TempDir()
	t.Setenv("CONTEXT_DROP_HOME", home)
	runtimeDir := filepath.Join(home, "runtime")
	if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	config := `{"host":"127.0.0.1","port":1,"stateDir":"` + home + `","tokenFile":"` + filepath.Join(home, "token") + `","nodePath":"/opt/homebrew/bin/node","herdrSession":"default","agents":{"pi":{"command":["pi"]}}}`
	if err := os.WriteFile(filepath.Join(runtimeDir, "config.json"), []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	root := NewRootCommand(BuildInfo{})
	out := &bytes.Buffer{}
	root.SetOut(out)
	root.SetErr(out)

	add := []string{"schedule", "add", "--name", "demo", "--agent", "pi", "--repo", "/tmp", "--prompt", "original prompt", "--every", "1h"}
	root.SetArgs(add)
	if err := root.Execute(); err != nil {
		t.Fatalf("add: %v", err)
	}

	// Show the prompt with the positional name form.
	root = NewRootCommand(BuildInfo{})
	out = &bytes.Buffer{}
	root.SetOut(out)
	root.SetErr(out)
	root.SetArgs([]string{"schedule", "demo"})
	if err := root.Execute(); err != nil {
		t.Fatalf("show: %v", err)
	}
	if !strings.Contains(out.String(), "original prompt") {
		t.Fatalf("show output missing prompt: %q", out.String())
	}

	// Update the prompt with the positional form.
	root = NewRootCommand(BuildInfo{})
	out = &bytes.Buffer{}
	root.SetOut(out)
	root.SetErr(out)
	root.SetArgs([]string{"schedule", "demo", "revised prompt"})
	if err := root.Execute(); err != nil {
		t.Fatalf("set: %v", err)
	}

	root = NewRootCommand(BuildInfo{})
	out = &bytes.Buffer{}
	root.SetOut(out)
	root.SetErr(out)
	root.SetArgs([]string{"schedule", "demo"})
	if err := root.Execute(); err != nil {
		t.Fatalf("show after set: %v", err)
	}
	if !strings.Contains(out.String(), "revised prompt") || strings.Contains(out.String(), "original prompt") {
		t.Fatalf("prompt not updated: %q", out.String())
	}

	// The other fields survive the edit.
	listOut := &bytes.Buffer{}
	root = NewRootCommand(BuildInfo{})
	root.SetOut(listOut)
	root.SetArgs([]string{"schedule", "list"})
	if err := root.Execute(); err != nil {
		t.Fatalf("list: %v", err)
	}
	if !strings.Contains(listOut.String(), "agent=pi") || !strings.Contains(listOut.String(), "1h") {
		t.Fatalf("other fields not preserved: %q", listOut.String())
	}
}

func TestSchedulePositionalPromptNotFound(t *testing.T) {
	t.Setenv("CONTEXT_DROP_HOME", t.TempDir())
	root := NewRootCommand(BuildInfo{})
	root.SetArgs([]string{"schedule", "missing", "new prompt"})
	if err := root.Execute(); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected not-found error, got %v", err)
	}
}

func TestScheduleSubcommandsStillRoute(t *testing.T) {
	root := NewRootCommand(BuildInfo{})
	if cmd, _, err := root.Find([]string{"schedule", "list"}); err != nil || cmd.Name() != "list" {
		t.Fatalf("list did not route: %v %v", cmd.Name(), err)
	}
}
