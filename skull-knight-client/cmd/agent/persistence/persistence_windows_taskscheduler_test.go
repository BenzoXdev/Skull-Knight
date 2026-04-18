//go:build windows && persist_taskscheduler
// +build windows,persist_taskscheduler

package persistence

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func queryTask(t *testing.T, taskName string) string {
	t.Helper()
	out, err := exec.Command("powershell.exe",
		"-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
		"-Command",
		`(Get-ScheduledTask -TaskName '`+taskName+`' -ErrorAction SilentlyContinue).Actions.Execute`).
		Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func deleteTask(t *testing.T, taskName string) {
	t.Helper()
	_ = runPowerShell(`Unregister-ScheduledTask -TaskName '` + taskName + `' -Confirm:$false -ErrorAction SilentlyContinue`)
}

// TestInstallTaskScheduler_RegistersTask verifies that a task with the
// derived name is created and points to the supplied executable path.
func TestInstallTaskScheduler_RegistersTask(t *testing.T) {
	target := `C:\Testing\sk_tstest.exe`
	taskName := deriveTaskName(target)
	t.Cleanup(func() { deleteTask(t, taskName) })

	if err := installTaskScheduler(target); err != nil {
		t.Fatalf("installTaskScheduler: %v", err)
	}

	got := queryTask(t, taskName)
	if got == "" {
		t.Fatalf("scheduled task %q was not created", taskName)
	}
	if !strings.EqualFold(got, target) {
		t.Fatalf("task Execute = %q, want %q", got, target)
	}
}

// TestInstallTaskScheduler_Idempotent verifies that calling install twice
// updates the existing task rather than creating a second one.
func TestInstallTaskScheduler_Idempotent(t *testing.T) {
	first := `C:\Testing\sk_ts_first.exe`
	second := `C:\Testing\sk_ts_second.exe`
	taskName := deriveTaskName(first)
	t.Cleanup(func() { deleteTask(t, taskName) })

	if err := installTaskScheduler(first); err != nil {
		t.Fatalf("installTaskScheduler(first): %v", err)
	}
	if err := installTaskScheduler(second); err != nil {
		t.Fatalf("installTaskScheduler(second): %v", err)
	}

	got := queryTask(t, taskName)
	if !strings.EqualFold(got, second) {
		t.Fatalf("task Execute after update = %q, want %q", got, second)
	}
}

// TestInstallTaskScheduler_SingleQuoteInPath checks that a path containing a
// single-quote is escaped correctly and does not cause a PowerShell error.
func TestInstallTaskScheduler_SingleQuoteInPath(t *testing.T) {
	dir := t.TempDir()
	// Create a sub-directory whose name contains a single quote.
	quotedDir := filepath.Join(dir, "O'Brien")
	if err := os.MkdirAll(quotedDir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	target := filepath.Join(quotedDir, "sk_quote.exe")
	taskName := deriveTaskName(target)
	t.Cleanup(func() { deleteTask(t, taskName) })

	if err := installTaskScheduler(target); err != nil {
		t.Fatalf("installTaskScheduler with quoted path: %v", err)
	}

	got := queryTask(t, taskName)
	if got == "" {
		t.Fatalf("scheduled task %q was not created", taskName)
	}
}

// TestUninstallTaskScheduler_RemovesTask verifies that uninstallTaskScheduler
// removes tasks whose names match the executable prefix.
func TestUninstallTaskScheduler_RemovesTask(t *testing.T) {
	target := `C:\Testing\sk_ts_uninstall.exe`
	taskName := deriveTaskName(target)
	t.Cleanup(func() { deleteTask(t, taskName) })

	if err := installTaskScheduler(target); err != nil {
		t.Fatalf("installTaskScheduler: %v", err)
	}
	if got := queryTask(t, taskName); got == "" {
		t.Fatalf("pre-condition: task %q not created", taskName)
	}

	if err := uninstallTaskScheduler(); err != nil {
		t.Fatalf("uninstallTaskScheduler: %v", err)
	}

	if got := queryTask(t, taskName); got != "" {
		t.Fatalf("task %q still exists after uninstall, Execute=%q", taskName, got)
	}
}

// TestInstallTaskSchedulerFull_CopiesAndRegisters verifies that
// installTaskSchedulerFull copies the source binary to the appdata dir and
// registers a scheduled task pointing to the copy.
func TestInstallTaskSchedulerFull_CopiesAndRegisters(t *testing.T) {
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)

	// Write a tiny stub "executable" as the source.
	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "agent.exe")
	if err := os.WriteFile(srcPath, []byte("MZ"), 0755); err != nil {
		t.Fatalf("write source: %v", err)
	}

	if err := installTaskSchedulerFull(srcPath); err != nil {
		t.Fatalf("installTaskSchedulerFull: %v", err)
	}

	// The binary must have been copied to the appdata binary dir.
	entries, err := os.ReadDir(filepath.Join(appData, appDataBinaryDir))
	if err != nil {
		t.Fatalf("read appdata dir: %v", err)
	}
	var copiedName string
	for _, e := range entries {
		if !e.IsDir() {
			copiedName = e.Name()
			break
		}
	}
	if copiedName == "" {
		t.Fatal("no binary found in appdata binary dir after installTaskSchedulerFull")
	}

	// A scheduled task pointing to the copy must exist.
	targetPath := filepath.Join(appData, appDataBinaryDir, copiedName)
	taskName := deriveTaskName(targetPath)
	t.Cleanup(func() { deleteTask(t, taskName) })

	got := queryTask(t, taskName)
	if !strings.EqualFold(got, targetPath) {
		t.Fatalf("task Execute = %q, want %q", got, targetPath)
	}
}

// TestInstallTaskSchedulerFull_SkipsCopyWhenAlreadyAtTarget verifies that
// when the source and target paths are the same file, no copy is attempted
// (no error from trying to replace a file with itself).
func TestInstallTaskSchedulerFull_SkipsCopyWhenAlreadyAtTarget(t *testing.T) {
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)

	// Pre-create the binary directly in the appdata binary dir.
	destDir := filepath.Join(appData, appDataBinaryDir)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	name, _ := generateBinaryName()
	destPath := filepath.Join(destDir, name)
	if err := os.WriteFile(destPath, []byte("MZ"), 0755); err != nil {
		t.Fatalf("write dest: %v", err)
	}

	taskName := deriveTaskName(destPath)
	t.Cleanup(func() { deleteTask(t, taskName) })

	// Pass the already-placed binary as the source — no copy should occur.
	if err := installTaskSchedulerFull(destPath); err != nil {
		t.Fatalf("installTaskSchedulerFull (same path): %v", err)
	}

	got := queryTask(t, taskName)
	if !strings.EqualFold(got, destPath) {
		t.Fatalf("task Execute = %q, want %q", got, destPath)
	}
}

// TestInstallTaskScheduler_CustomName verifies that when DefaultStartupName is
// set, the derived task name uses that prefix.
func TestInstallTaskScheduler_CustomName(t *testing.T) {
	origName := DefaultStartupName
	t.Cleanup(func() { DefaultStartupName = origName })
	DefaultStartupName = "svchost"

	target := `C:\Testing\svchost.exe`
	taskName := deriveTaskName(target)
	t.Cleanup(func() { deleteTask(t, taskName) })

	if !strings.HasPrefix(taskName, "svchost_") {
		t.Fatalf("expected task name to start with 'svchost_', got %q", taskName)
	}

	if err := installTaskScheduler(target); err != nil {
		t.Fatalf("installTaskScheduler with custom name: %v", err)
	}

	got := queryTask(t, taskName)
	if got == "" {
		t.Fatalf("task %q not created", taskName)
	}
}
