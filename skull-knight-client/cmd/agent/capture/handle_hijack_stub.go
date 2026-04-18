//go:build !windows

package capture

import (
	"io"
	"os"
	"path/filepath"
)

func forceCopyFile(src, dst string) (int64, error) {
	in, err := os.Open(src)
	if err != nil {
		return 0, err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0700); err != nil {
		return 0, err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return 0, err
	}
	defer out.Close()
	return io.Copy(out, in)
}

func forceReadFile(filePath string) ([]byte, error) {
	return os.ReadFile(filePath)
}
