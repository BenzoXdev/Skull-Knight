//go:build windows

package sysinfo

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

func IsAdmin() bool {
	token := windows.GetCurrentProcessToken()
	return token.IsElevated()
}

func Elevation() string {
	token := windows.GetCurrentProcessToken()

	tu, err := token.GetTokenUser()
	if err == nil {
		sid := tu.User.Sid
		if isTrustedInstallerSID(sid) {
			return "trustedinstaller"
		}
		if isLocalSystemSID(sid) {
			return "system"
		}
	}

	if token.IsElevated() {
		return "admin"
	}
	return ""
}

func isLocalSystemSID(sid *windows.SID) bool {
	system, err := windows.StringToSid("S-1-5-18")
	if err != nil {
		return false
	}
	return sid.Equals(system)
}

func isTrustedInstallerSID(sid *windows.SID) bool {
	ti, err := windows.StringToSid("S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464")
	if err != nil {
		return false
	}
	if sid.Equals(ti) {
		return true
	}
	idAuth := (*[6]byte)(unsafe.Pointer(uintptr(unsafe.Pointer(sid)) + 2))
	if idAuth[5] == 5 { // SECURITY_NT_AUTHORITY
		subAuthCount := *(*byte)(unsafe.Pointer(uintptr(unsafe.Pointer(sid)) + 1))
		if subAuthCount >= 1 {
			firstSub := *(*uint32)(unsafe.Pointer(uintptr(unsafe.Pointer(sid)) + 8))
			if firstSub == 80 { // SECURITY_SERVICE_ID_BASE_RID
				return true
			}
		}
	}
	return false
}

func DarwinPermissions() map[string]bool {
	return nil
}
