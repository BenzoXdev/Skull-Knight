//go:build !windows

package handlers

import (
	"context"

	"skull-knight-client/cmd/agent/runtime"
)

func ClipboardSyncStart(_ context.Context, _ *runtime.Env, _ string) {}
func ClipboardSyncSet(_ string)                                      {}
