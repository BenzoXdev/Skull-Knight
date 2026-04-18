package audio

type Capabilities struct {
	Available     bool     `json:"available"`
	RequiresCGO   bool     `json:"requiresCgo"`
	Sources       []string `json:"sources"`
	DefaultSource string   `json:"defaultSource"`
	Detail        string   `json:"detail,omitempty"`
}
