package handlers

import (
	"context"
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	"skull-knight-client/cmd/agent/runtime"
	"skull-knight-client/cmd/agent/wire"
)

var (
	tunnelMu    sync.Mutex
	tunnelConns = make(map[string]*tunnelConn) // connectionId → tunnelConn
)

type tunnelConn struct {
	conn   net.Conn
	cancel context.CancelFunc
}

func HandleProxyConnect(ctx context.Context, env *runtime.Env, connID string, payload map[string]interface{}) error {
	host, _ := payload["host"].(string)
	portRaw := payload["port"]
	var port int
	switch v := portRaw.(type) {
	case int:
		port = v
	case int8:
		port = int(v)
	case int16:
		port = int(v)
	case int32:
		port = int(v)
	case int64:
		port = int(v)
	case uint:
		port = int(v)
	case uint8:
		port = int(v)
	case uint16:
		port = int(v)
	case uint32:
		port = int(v)
	case uint64:
		port = int(v)
	case float32:
		port = int(v)
	case float64:
		port = int(v)
	}

	if host == "" || port <= 0 || port > 65535 {
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
			Type:      "command_result",
			CommandID: connID,
			OK:        false,
			Message:   "Invalid host or port",
		})
	}

	target := fmt.Sprintf("%s:%d", host, port)

	goSafe("tunnel-dial-"+connID, nil, func() {

		targetConn, err := net.DialTimeout("tcp", target, 10*time.Second)
		if err != nil {
			log.Printf("[tunnel] failed to connect to %s: %v", target, err)
			_ = wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
				Type:      "command_result",
				CommandID: connID,
				OK:        false,
				Message:   fmt.Sprintf("Connection refused: %v", err),
			})
			return
		}

		tunnelCtx, tunnelCancel := context.WithCancel(context.Background())
		tc := &tunnelConn{conn: targetConn, cancel: tunnelCancel}

		tunnelMu.Lock()
		tunnelConns[connID] = tc
		tunnelMu.Unlock()

		// tell the server we connected successfully
		if err := wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
			Type:      "command_result",
			CommandID: connID,
			OK:        true,
			Message:   "Connected",
		}); err != nil {
			targetConn.Close()
			tunnelCancel()
			tunnelMu.Lock()
			delete(tunnelConns, connID)
			tunnelMu.Unlock()
			return
		}

		defer func() {
			tunnelCancel()
			targetConn.Close()
			tunnelMu.Lock()
			delete(tunnelConns, connID)
			tunnelMu.Unlock()
			_ = wire.WriteMsg(ctx, env.Conn, wire.ProxyClose{
				Type:         "proxy_close",
				ConnectionID: connID,
			})

		}()

		buf := make([]byte, 32*1024)
		for {
			select {
			case <-tunnelCtx.Done():
				return
			default:
			}
			n, err := targetConn.Read(buf)
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				if writeErr := wire.WriteMsg(ctx, env.Conn, wire.ProxyData{
					Type:         "proxy_data",
					ConnectionID: connID,
					Data:         data,
				}); writeErr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	})

	return nil
}

func HandleProxyData(ctx context.Context, env *runtime.Env, connID string, payload map[string]interface{}) error {
	tunnelMu.Lock()
	tc, ok := tunnelConns[connID]
	tunnelMu.Unlock()
	if !ok {
		return nil
	}

	var data []byte
	switch v := payload["data"].(type) {
	case []byte:
		data = v
	case string:
		data = []byte(v)
	default:
		return nil
	}

	if _, err := tc.conn.Write(data); err != nil {
		tc.cancel()
		return nil
	}
	return nil
}

func HandleProxyClose(ctx context.Context, env *runtime.Env, connID string) error {
	tunnelMu.Lock()
	tc, ok := tunnelConns[connID]
	if ok {
		delete(tunnelConns, connID)
	}
	tunnelMu.Unlock()
	if ok {
		tc.cancel()
		tc.conn.Close()
	}
	return nil
}

func CleanupAllTunnels() {
	tunnelMu.Lock()
	defer tunnelMu.Unlock()
	for id, tc := range tunnelConns {
		tc.cancel()
		tc.conn.Close()
		delete(tunnelConns, id)
	}
}
