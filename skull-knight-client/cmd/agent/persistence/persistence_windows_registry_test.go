//go:build windows && persist_registry
// +build windows,persist_registry

package persistence

import (
	"strings"
	"testing"

	"golang.org/x/sys/windows/registry"
)

func TestInstallRegistry_WritesQuotedValue(t *testing.T) {
	dummy := `C:\Testing\sk_testvalue.exe`
	if err := installRegistry(dummy); err != nil {
		t.Fatalf("installRegistry: %v", err)
	}

	k, err := registry.OpenKey(registry.CURRENT_USER, registryKey,
		registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		t.Fatalf("open registry key: %v", err)
	}
	defer k.Close()

	names, _ := k.ReadValueNames(0)
	var found string
	for _, name := range names {
		if strings.HasPrefix(strings.ToLower(name), strings.ToLower(registryValuePrefix)) {
			val, _, _ := k.GetStringValue(name)
			if strings.Contains(val, "sk_testvalue.exe") {
				found = name
				break
			}
		}
	}
	if found == "" {
		t.Fatal("installRegistry did not write expected Run key value")
	}
	val, _, _ := k.GetStringValue(found)
	if !strings.HasPrefix(val, `"`) || !strings.HasSuffix(val, `"`) {
		t.Fatalf("expected quoted value like \"...\", got %q", val)
	}
	_ = k.DeleteValue(found)
}

func TestInstallRegistry_UpdatesExistingValue(t *testing.T) {
	first := `C:\Testing\sk_first.exe`
	second := `C:\Testing\sk_second.exe`

	if err := installRegistry(first); err != nil {
		t.Fatalf("installRegistry(first): %v", err)
	}
	if err := installRegistry(second); err != nil {
		t.Fatalf("installRegistry(second): %v", err)
	}

	k, err := registry.OpenKey(registry.CURRENT_USER, registryKey,
		registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		t.Fatalf("open registry key: %v", err)
	}
	defer k.Close()

	names, _ := k.ReadValueNames(0)
	var matches []string
	for _, name := range names {
		if strings.HasPrefix(strings.ToLower(name), strings.ToLower(registryValuePrefix)) {
			val, _, _ := k.GetStringValue(name)
			if strings.Contains(val, "sk_first.exe") || strings.Contains(val, "sk_second.exe") {
				matches = append(matches, name)
			}
		}
	}
	for _, name := range matches {
		_ = k.DeleteValue(name)
	}
	if len(matches) != 1 {
		t.Fatalf("expected exactly 1 Run value for the two installs, got %d", len(matches))
	}
}
