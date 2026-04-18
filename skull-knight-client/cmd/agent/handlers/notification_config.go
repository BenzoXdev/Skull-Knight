package handlers

import (
	"context"
	"log"
	"strings"

	"skull-knight-client/cmd/agent/runtime"
)

func HandleNotificationConfig(_ context.Context, env *runtime.Env, envelope map[string]interface{}) error {
	if env == nil || envelope == nil {
		return nil
	}

	var keywords []string
	minInterval := 0
	clipboardEnabled := false

	if raw, ok := envelope["keywords"].([]interface{}); ok {
		for _, v := range raw {
			if s, ok := v.(string); ok {
				s = strings.TrimSpace(s)
				if s != "" {
					keywords = append(keywords, s)
				}
			}
		}
	}
	if v, ok := envelope["minIntervalMs"].(float64); ok {
		minInterval = int(v)
	}
	if v, ok := envelope["minIntervalMs"].(int); ok {
		minInterval = v
	}
	if v, ok := envelope["clipboardEnabled"].(bool); ok {
		clipboardEnabled = v
	}

	env.SetNotificationConfig(keywords, minInterval, clipboardEnabled)
	log.Printf("notification_config: loaded %d keywords clipboard=%v", len(keywords), clipboardEnabled)
	return nil
}
