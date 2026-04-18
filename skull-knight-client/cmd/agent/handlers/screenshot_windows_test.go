//go:build windows

package handlers

import (
	"image"
	"image/color"
	"testing"
)

func TestCaptureScreenshotImageWindows_PrimaryOnly(t *testing.T) {
	origMonitorCountFn := monitorCountFn
	origCaptureFn := captureDisplayRGBABitBltFn
	t.Cleanup(func() {
		monitorCountFn = origMonitorCountFn
		captureDisplayRGBABitBltFn = origCaptureFn
	})

	monitorCountFn = func() int { return 2 }
	captureDisplayRGBABitBltFn = func(display int) (*image.RGBA, error) {
		img := image.NewRGBA(image.Rect(0, 0, 3, 2))
		img.SetRGBA(0, 0, color.RGBA{R: 255, A: 255})
		return img, nil
	}

	img, displayIndex, bounds, err := captureScreenshotImageWindows(false)
	if err != nil {
		t.Fatalf("captureScreenshotImageWindows(false) failed: %v", err)
	}
	if img == nil {
		t.Fatal("expected image, got nil")
	}
	if displayIndex != 0 {
		t.Fatalf("expected displayIndex 0, got %d", displayIndex)
	}
	if bounds.Dx() != 3 || bounds.Dy() != 2 {
		t.Fatalf("expected bounds 3x2, got %dx%d", bounds.Dx(), bounds.Dy())
	}
}

func TestCaptureScreenshotImageWindows_AllDisplaysStitched(t *testing.T) {
	origMonitorCountFn := monitorCountFn
	origBoundsFn := displayBoundsFn
	origCaptureFn := captureDisplayRGBABitBltFn
	t.Cleanup(func() {
		monitorCountFn = origMonitorCountFn
		displayBoundsFn = origBoundsFn
		captureDisplayRGBABitBltFn = origCaptureFn
	})

	monitorCountFn = func() int { return 2 }
	displayBoundsFn = func(idx int) image.Rectangle {
		if idx == 0 {
			return image.Rect(0, 0, 2, 2)
		}
		return image.Rect(2, 0, 4, 2)
	}
	captureDisplayRGBABitBltFn = func(display int) (*image.RGBA, error) {
		img := image.NewRGBA(image.Rect(0, 0, 2, 2))
		if display == 0 {
			img.SetRGBA(0, 0, color.RGBA{R: 255, A: 255})
		} else {
			img.SetRGBA(0, 0, color.RGBA{G: 255, A: 255})
		}
		return img, nil
	}

	img, displayIndex, bounds, err := captureScreenshotImageWindows(true)
	if err != nil {
		t.Fatalf("captureScreenshotImageWindows(true) failed: %v", err)
	}
	if img == nil {
		t.Fatal("expected stitched image, got nil")
	}
	if displayIndex != 0 {
		t.Fatalf("expected displayIndex 0, got %d", displayIndex)
	}
	if bounds.Dx() != 4 || bounds.Dy() != 2 {
		t.Fatalf("expected stitched bounds 4x2, got %dx%d", bounds.Dx(), bounds.Dy())
	}

	left := img.RGBAAt(0, 0)
	right := img.RGBAAt(2, 0)
	if left.R != 255 || left.G != 0 {
		t.Fatalf("expected left monitor red marker, got %+v", left)
	}
	if right.G != 255 || right.R != 0 {
		t.Fatalf("expected right monitor green marker, got %+v", right)
	}
}

func TestCaptureScreenshotImageWindows_NoDisplays(t *testing.T) {
	origMonitorCountFn := monitorCountFn
	t.Cleanup(func() {
		monitorCountFn = origMonitorCountFn
	})

	monitorCountFn = func() int { return 0 }

	img, _, _, err := captureScreenshotImageWindows(false)
	if err == nil {
		t.Fatal("expected error for no displays, got nil")
	}
	if img != nil {
		t.Fatal("expected nil image on error")
	}
}
