package main

import (
	"encoding/json"
	"log"
	"sync"
)

type HostInfo struct {
	ClientID string `json:"clientId"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Version  string `json:"version"`
}

var (
	hostInfo HostInfo
	sendFn   func(event string, payload []byte)
	mu       sync.Mutex
)

func setSend(fn func(event string, payload []byte)) {
	mu.Lock()
	sendFn = fn
	mu.Unlock()
}

func sendEvent(event string, payload interface{}) {
	mu.Lock()
	fn := sendFn
	mu.Unlock()
	if fn == nil {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[sample] marshal error: %v", err)
		return
	}
	fn(event, data)
}

func handleInit(hostJSON []byte) error {
	if err := json.Unmarshal(hostJSON, &hostInfo); err != nil {
		return err
	}
	log.Printf("[sample] init: clientId=%s os=%s arch=%s", hostInfo.ClientID, hostInfo.OS, hostInfo.Arch)
	sendEvent("ready", map[string]string{"message": "sample plugin ready"})
	return nil
}

func handleEvent(event string, payload []byte) error {
	switch event {
	case "ui_message":
		var msg struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(payload, &msg)
		log.Printf("[sample] got ui_message: %s", msg.Message)
		sendEvent("echo", map[string]string{"message": msg.Message})

	case "ping":
		sendEvent("pong", nil)

	default:
		log.Printf("[sample] unhandled event: %s", event)
	}
	return nil
}

func handleUnload() {
	log.Printf("[sample] unloading")
}
