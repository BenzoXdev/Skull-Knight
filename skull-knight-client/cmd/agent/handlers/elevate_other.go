//go:build !darwin

package handlers

import (
	"context"

	agentRuntime "skull-knight-client/cmd/agent/runtime"
	"skull-knight-client/cmd/agent/wire"
)

func HandleElevate(ctx context.Context, env *agentRuntime.Env, cmdID string, password string) error {
	return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
		Type:      "command_result",
		CommandID: cmdID,
		OK:        false,
		Message:   "elevation via password is only supported on macOS",
	})
}
