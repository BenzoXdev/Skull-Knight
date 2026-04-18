//go:build windows

package config

import (
	"log"

	"golang.org/x/sys/windows/registry"
)

func platformMachineID() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Cryptography`, registry.QUERY_VALUE)
	if err != nil {
		log.Printf("[identity] WARNING: failed to open Cryptography registry key: %v", err)
		return ""
	}
	defer k.Close()

	val, _, err := k.GetStringValue("MachineGuid")
	if err != nil {
		log.Printf("[identity] WARNING: failed to read MachineGuid: %v", err)
		return ""
	}
	return val
}
