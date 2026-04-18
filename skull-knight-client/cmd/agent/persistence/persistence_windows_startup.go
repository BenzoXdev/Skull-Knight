//go:build windows && persist_startup
// +build windows,persist_startup

package persistence

func init() {
	hasStartupMethod = true
	persistInstallFns = append(persistInstallFns, installStartupImpl)
}
