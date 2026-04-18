package wire

import (
	"context"
	"time"

	"nhooyr.io/websocket"
)

const writeTimeout = 30 * time.Second

type SafeWriter struct {
	sem chan struct{}
	w   Writer
}

func NewSafeWriter(w Writer) *SafeWriter {
	sem := make(chan struct{}, 1)
	sem <- struct{}{}
	return &SafeWriter{sem: sem, w: w}
}

func (s *SafeWriter) Write(ctx context.Context, messageType websocket.MessageType, p []byte) error {
	select {
	case <-s.sem:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { s.sem <- struct{}{} }()

	writeCtx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	return s.w.Write(writeCtx, messageType, p)
}
