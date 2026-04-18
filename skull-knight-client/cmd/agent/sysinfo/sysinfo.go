package sysinfo

type Info struct {
	CPU string `json:"cpu,omitempty"`
	GPU string `json:"gpu,omitempty"`
	RAM string `json:"ram,omitempty"`
}

func Collect() Info {
	return collectPlatform()
}
