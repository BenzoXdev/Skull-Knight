package handlers

import (
	"context"
	"log"
	"skull-knight-client/cmd/agent/runtime"
	"skull-knight-client/cmd/agent/wire"
	"time"
)

func HandlePing(ctx context.Context, env *runtime.Env, envelope map[string]interface{}) error {

	ts := extractTimestamp(envelope["ts"])
	if ts == 0 {
		ts = time.Now().UnixMilli()
	}
	env.SetLastPong(time.Now().UnixMilli())

	pong := wire.Pong{Type: "pong", TS: ts}
	go func() {
		defer recoverAndLog("pong sender", nil)
		if err := wire.WriteMsg(ctx, env.Conn, pong); err != nil {
			log.Printf("ping: failed to send pong: %v", err)
		}
	}()

	return nil
}
