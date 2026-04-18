//go:build linux && !android

package config

import (
	"log"
	"os"
	"strings"
)

func platformMachineID() string {
	data, err := os.ReadFile("/etc/machine-id")
	if err != nil {
		log.Printf("[identity] WARNING: failed to read /etc/machine-id: %v", err)
		return ""
	}
	return strings.TrimSpace(string(data))
}
