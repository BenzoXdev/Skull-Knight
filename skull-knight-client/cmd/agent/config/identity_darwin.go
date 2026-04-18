//go:build darwin

package config

import (
	"log"
	"os/exec"
	"strings"
)

func platformMachineID() string {
	out, err := exec.Command("ioreg", "-rd1", "-c", "IOPlatformExpertDevice").Output()
	if err != nil {
		log.Printf("[identity] WARNING: failed to run ioreg: %v", err)
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "IOPlatformUUID") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				return strings.Trim(strings.TrimSpace(parts[1]), `"`)
			}
		}
	}
	log.Printf("[identity] WARNING: IOPlatformUUID not found in ioreg output")
	return ""
}
