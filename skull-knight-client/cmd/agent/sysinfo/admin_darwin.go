//go:build darwin

package sysinfo

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func IsAdmin() bool {
	return os.Getuid() == 0
}

func Elevation() string {
	if os.Getuid() == 0 {
		return "admin"
	}
	return ""
}

func DarwinPermissions() map[string]bool {
	return map[string]bool{
		"screenRecording": checkScreenRecording(),
		"accessibility":   checkAccessibility(),
		"fullDiskAccess":  checkFullDiskAccess(),
		"root":            os.Getuid() == 0,
	}
}

func checkScreenRecording() bool {
	if os.Getuid() == 0 {
		return true
	}
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return false
	}
	db := filepath.Join(home, "Library", "Application Support", "com.apple.TCC", "TCC.db")
	safeExe := strings.ReplaceAll(exe, "'", "''")
	out, _ := exec.Command("sqlite3", db,
		"SELECT auth_value FROM access WHERE service='kTCCServiceScreenCapture' AND client='"+safeExe+"' LIMIT 1",
	).CombinedOutput()
	return strings.TrimSpace(string(out)) == "2"
}

func checkAccessibility() bool {
	err := exec.Command("osascript", "-e",
		`tell application "System Events" to get name of first process`).Run()
	return err == nil
}

func checkFullDiskAccess() bool {
	_, err := os.ReadDir("/Library/Application Support/com.apple.TCC")
	return err == nil
}
