//go:build !windows
// +build !windows

package handlers

import (
	"context"
	"fmt"

	"skull-knight-client/cmd/agent/runtime"
)

func handleWinREInstall(ctx context.Context, env *runtime.Env, cmdID string, filePath string, useSelf bool) error {
	return fmt.Errorf("WinRE persistence is only supported on Windows")
}

func handleWinREUninstall(ctx context.Context, env *runtime.Env, cmdID string) error {
	return fmt.Errorf("WinRE persistence is only supported on Windows")
}
