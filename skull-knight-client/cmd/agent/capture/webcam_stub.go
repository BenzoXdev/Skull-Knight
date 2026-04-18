//go:build !windows || !cgo

package capture

import (
	"context"
	"errors"

	rt "skull-knight-client/cmd/agent/runtime"
)

func NowWebcam(_ context.Context, _ *rt.Env) error {
	return errors.New("webcam capture is only supported on Windows")
}

func CleanupWebcam() {
}
