//go:build !windows && !linux && !darwin

package persistence

import "fmt"

func install(_ string) error {
	return fmt.Errorf("persistence is not implemented on this platform")
}

func configure(_ string) error {
	return fmt.Errorf("persistence is not implemented on this platform")
}

func getTargetPath() (string, error) {
	return "", fmt.Errorf("persistence is not implemented on this platform")
}

func uninstall() error {
	return nil
}
