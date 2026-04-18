package handlers

import (
	"context"
	"time"

	"skull-knight-client/cmd/agent/runtime"
)

func HandlePong(_ context.Context, env *runtime.Env, envelope map[string]interface{}) error {
	env.SetLastPong(time.Now().UnixMilli())
	return nil
}
