package activewindow

import (
	"regexp"
	"strings"
)

func matchKeyword(text string, keywords []string) string {
	if text == "" {
		return ""
	}
	lower := strings.ToLower(text)
	for _, kw := range keywords {
		trimmed := strings.TrimSpace(kw)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "/") {
			re, ok := parseRegexKeyword(trimmed)
			if ok && re.MatchString(text) {
				return kw
			}
		} else {
			if strings.Contains(lower, strings.ToLower(trimmed)) {
				return kw
			}
		}
	}
	return ""
}

func parseRegexKeyword(kw string) (*regexp.Regexp, bool) {
	if !strings.HasPrefix(kw, "/") {
		return nil, false
	}
	rest := kw[1:]
	lastSlash := strings.LastIndex(rest, "/")
	if lastSlash < 0 {
		return nil, false
	}
	pattern := rest[:lastSlash]
	flags := rest[lastSlash+1:]
	if pattern == "" {
		return nil, false
	}
	regexStr := pattern
	if strings.ContainsRune(flags, 'i') {
		regexStr = "(?i)" + pattern
	}
	re, err := regexp.Compile(regexStr)
	if err != nil {
		return nil, false
	}
	return re, true
}
