//go:build windows

package activewindow

import (
	"context"
	"log"
	"strings"
	"time"
	"unsafe"

	"skull-knight-client/cmd/agent/runtime"
	"skull-knight-client/cmd/agent/wire"

	"golang.org/x/sys/windows"
)

var (
	kernel32         = windows.NewLazySystemDLL("kernel32.dll")
	procGlobalLock   = kernel32.NewProc("GlobalLock")
	procGlobalUnlock = kernel32.NewProc("GlobalUnlock")

	procOpenClipboard    = user32.NewProc("OpenClipboard")
	procCloseClipboard   = user32.NewProc("CloseClipboard")
	procGetClipboardData = user32.NewProc("GetClipboardData")
)

const cfUnicodeText = 13

func StartClipboard(ctx context.Context, env *runtime.Env) error {
	if env == nil {
		return nil
	}
	log.Printf("clipboard: starting monitor")
	defer log.Printf("clipboard: stopped")

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	var lastContent string
	lastSent := make(map[string]int64)

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if !env.GetClipboardEnabled() {
				continue
			}
			keywords := env.GetNotificationKeywords()
			if len(keywords) == 0 {
				continue
			}
			minIntervalMs := env.GetNotificationMinIntervalMs()
			content := readClipboardText()
			if content == "" || content == lastContent {
				continue
			}
			lastContent = content
			match := matchKeyword(content, keywords)
			if match == "" {
				continue
			}
			if minIntervalMs > 0 {
				key := "clipboard:" + strings.ToLower(match)
				if last, ok := lastSent[key]; ok {
					if time.Since(time.UnixMilli(last)) < time.Duration(minIntervalMs)*time.Millisecond {
						continue
					}
				}
				lastSent[key] = time.Now().UnixMilli()
			}
			title := content
			if len(title) > 300 {
				title = title[:300]
			}
			note := wire.Notification{
				Type:     "notification",
				Category: "clipboard",
				Title:    title,
				Keyword:  match,
				TS:       time.Now().UnixMilli(),
			}
			if err := wire.WriteMsg(ctx, env.Conn, note); err != nil {
				log.Printf("clipboard: send notification failed: %v", err)
			}
		}
	}
}

func readClipboardText() string {
	r, _, _ := procOpenClipboard.Call(0)
	if r == 0 {
		return ""
	}
	defer procCloseClipboard.Call()
	h, _, _ := procGetClipboardData.Call(cfUnicodeText)
	if h == 0 {
		return ""
	}
	ptr, _, _ := procGlobalLock.Call(h)
	if ptr == 0 {
		return ""
	}
	defer procGlobalUnlock.Call(h)
	return utf16PtrFromUintptr(ptr)
}

func utf16PtrFromUintptr(ptr uintptr) string {
	if ptr == 0 {
		return ""
	}
	n := 0
	for {
		v := *(*uint16)(unsafe.Pointer(ptr + uintptr(n)*2))
		if v == 0 {
			break
		}
		n++
		if n > 1<<20 {
			break
		}
	}
	u16 := unsafe.Slice((*uint16)(unsafe.Pointer(ptr)), n)
	return windows.UTF16ToString(u16)
}
