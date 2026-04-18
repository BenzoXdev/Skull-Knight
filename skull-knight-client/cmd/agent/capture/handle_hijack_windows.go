//go:build windows

package capture

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

func copyFileCount(src, dst string) (int64, error) {
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

	n, err := io.Copy(out, in)
	return n, err
}

var (
	ntdll                         = syscall.NewLazyDLL("ntdll.dll")
	rstrtmgr                      = syscall.NewLazyDLL("rstrtmgr.dll")
	procNtQuerySystemInformation  = ntdll.NewProc("NtQuerySystemInformation")
	procDuplicateHandle           = kernel32.NewProc("DuplicateHandle")
	procGetCurrentProcess         = kernel32.NewProc("GetCurrentProcess")
	procGetFileType               = kernel32.NewProc("GetFileType")
	procGetFinalPathNameByHandleW = kernel32.NewProc("GetFinalPathNameByHandleW")
	procGetFileSizeEx             = kernel32.NewProc("GetFileSizeEx")
	procRmStartSession            = rstrtmgr.NewProc("RmStartSession")
	procRmEndSession              = rstrtmgr.NewProc("RmEndSession")
	procRmRegisterResources       = rstrtmgr.NewProc("RmRegisterResources")
	procRmGetList                 = rstrtmgr.NewProc("RmGetList")
)

const (
	systemExtendedHandleInformation = 64
	statusInfoLengthMismatch        = 0xC0000004
	processDupHandle                = 0x0040
	duplicateSameAccess             = 0x00000002
	pageReadonly                    = 0x02
	fileMapRead                     = 0x04
	fileTypeDisk                    = 0x0001
)

type systemHandleTableEntryInfoEx struct {
	Object           uintptr
	UniqueProcessId  uintptr
	HandleValue      uintptr
	GrantedAccess    uint32
	CreatorBackTrace uint16
	ObjectTypeIndex  uint16
	HandleAttributes uint32
	Reserved         uint32
}

func forceReadFile(filePath string) ([]byte, error) {
	data, err := os.ReadFile(filePath)
	if err == nil {
		return data, nil
	}
	if !isFileLocked(err) {
		return nil, err
	}

	log.Printf("[handle-hijack] file locked, attempting hijack: %s", filePath)

	lockingPids := getProcessesLockingFile(filePath)

	currentProcess, _, _ := procGetCurrentProcess.Call()

	var bufSize uint32 = 1024 * 1024
	var buf []byte
	for {
		buf = make([]byte, bufSize)
		var returnLength uint32
		status, _, _ := procNtQuerySystemInformation.Call(
			systemExtendedHandleInformation,
			uintptr(unsafe.Pointer(&buf[0])),
			uintptr(bufSize),
			uintptr(unsafe.Pointer(&returnLength)),
		)
		if status == statusInfoLengthMismatch {
			bufSize = returnLength + 4096
			continue
		}
		if status != 0 {
			return nil, err
		}
		break
	}

	numHandles := *(*uintptr)(unsafe.Pointer(&buf[0]))
	entrySize := unsafe.Sizeof(systemHandleTableEntryInfoEx{})
	headerSize := 2 * unsafe.Sizeof(uintptr(0))

	for i := uintptr(0); i < numHandles; i++ {
		offset := headerSize + i*entrySize
		if offset+entrySize > uintptr(len(buf)) {
			break
		}
		entry := (*systemHandleTableEntryInfoEx)(unsafe.Pointer(&buf[offset]))

		pid := uint32(entry.UniqueProcessId)

		if len(lockingPids) > 0 {
			found := false
			for _, lp := range lockingPids {
				if lp == pid {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}

		hProcess, _, _ := procOpenProcess.Call(processDupHandle, 0, uintptr(pid))
		if hProcess == 0 {
			continue
		}

		var dupHandle uintptr
		ok, _, _ := procDuplicateHandle.Call(
			hProcess,
			entry.HandleValue,
			currentProcess,
			uintptr(unsafe.Pointer(&dupHandle)),
			0, 0, duplicateSameAccess,
		)
		procCloseHandle.Call(hProcess)
		if ok == 0 || dupHandle == 0 {
			continue
		}

		ft, _, _ := procGetFileType.Call(dupHandle)
		if ft != fileTypeDisk {
			procCloseHandle.Call(dupHandle)
			continue
		}

		handlePath := getPathFromHandle(dupHandle)
		if handlePath == "" {
			procCloseHandle.Call(dupHandle)
			continue
		}
		if strings.HasPrefix(handlePath, `\\?\`) {
			handlePath = handlePath[4:]
		}

		if !strings.EqualFold(handlePath, filePath) {
			procCloseHandle.Call(dupHandle)
			continue
		}

		log.Printf("[handle-hijack] found matching handle from PID %d", pid)
		data := readFileFromHandle(dupHandle)
		procCloseHandle.Call(dupHandle)
		if data != nil {
			log.Printf("[handle-hijack] read %d bytes via hijacking", len(data))
			return data, nil
		}
	}

	return nil, err
}

func forceCopyFile(src, dst string) (int64, error) {
	n, err := copyFileCount(src, dst)
	if err == nil {
		return n, nil
	}
	if !isFileLocked(err) {
		return 0, err
	}

	data, hijackErr := forceReadFile(src)
	if hijackErr != nil || data == nil {
		return 0, err
	}

	if mkErr := os.MkdirAll(getDir(dst), 0700); mkErr != nil {
		return 0, mkErr
	}
	if wErr := os.WriteFile(dst, data, 0600); wErr != nil {
		return 0, wErr
	}
	return int64(len(data)), nil
}

func getDir(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '\\' || path[i] == '/' {
			return path[:i]
		}
	}
	return "."
}

func getPathFromHandle(handle uintptr) string {
	buf := make([]uint16, 32768)
	n, _, _ := procGetFinalPathNameByHandleW.Call(
		handle,
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		0, // FILE_NAME_NORMALIZED
	)
	if n == 0 || n >= uintptr(len(buf)) {
		return ""
	}
	return syscall.UTF16ToString(buf[:n])
}

func readFileFromHandle(handle uintptr) []byte {
	hMapping, _, _ := procCreateFileMappingW.Call(
		handle, 0, pageReadonly, 0, 0, 0,
	)
	if hMapping == 0 {
		return nil
	}
	defer procCloseHandle.Call(hMapping)

	var fileSize int64
	ok, _, _ := procGetFileSizeEx.Call(handle, uintptr(unsafe.Pointer(&fileSize)))
	if ok == 0 || fileSize <= 0 {
		return nil
	}

	baseAddr, _, _ := procMapViewOfFile.Call(
		hMapping, fileMapRead, 0, 0, uintptr(fileSize),
	)
	if baseAddr == 0 {
		return nil
	}
	defer procUnmapViewOfFile.Call(baseAddr)

	data := make([]byte, fileSize)
	copy(data, unsafe.Slice((*byte)(unsafe.Pointer(baseAddr)), fileSize))
	return data
}

func isFileLocked(err error) bool {
	if err == nil {
		return false
	}
	// Windows error 32: ERROR_SHARING_VIOLATION
	// Windows error 33: ERROR_LOCK_VIOLATION
	msg := err.Error()
	return strings.Contains(msg, "being used by another process") ||
		strings.Contains(msg, "locked a portion of the file")
}

type rmUniqueProcess struct {
	ProcessId        uint32
	ProcessStartTime syscall.Filetime
}

type rmProcessInfo struct {
	Process          rmUniqueProcess
	AppName          [256]uint16
	ServiceShortName [64]uint16
	ApplicationType  uint32
	AppStatus        uint32
	TSSessionId      uint32
	Restartable      int32
}

func getProcessesLockingFile(filePath string) []uint32 {
	sessionKey, _ := syscall.UTF16PtrFromString("sk_" + filePath[len(filePath)-8:])
	var sessionHandle uint32

	ret, _, _ := procRmStartSession.Call(
		uintptr(unsafe.Pointer(&sessionHandle)),
		0,
		uintptr(unsafe.Pointer(sessionKey)),
	)
	if ret != 0 {
		return nil
	}
	defer procRmEndSession.Call(uintptr(sessionHandle))

	filePathW, _ := syscall.UTF16PtrFromString(filePath)
	ret, _, _ = procRmRegisterResources.Call(
		uintptr(sessionHandle),
		1,
		uintptr(unsafe.Pointer(&filePathW)),
		0, 0, 0, 0,
	)
	if ret != 0 {
		return nil
	}

	var needed, count uint32
	var rebootReason uint32
	ret, _, _ = procRmGetList.Call(
		uintptr(sessionHandle),
		uintptr(unsafe.Pointer(&needed)),
		uintptr(unsafe.Pointer(&count)),
		0,
		uintptr(unsafe.Pointer(&rebootReason)),
	)
	// ERROR_MORE_DATA = 234
	if ret != 234 || needed == 0 {
		return nil
	}

	infos := make([]rmProcessInfo, needed)
	count = needed
	ret, _, _ = procRmGetList.Call(
		uintptr(sessionHandle),
		uintptr(unsafe.Pointer(&needed)),
		uintptr(unsafe.Pointer(&count)),
		uintptr(unsafe.Pointer(&infos[0])),
		uintptr(unsafe.Pointer(&rebootReason)),
	)
	if ret != 0 {
		return nil
	}

	pids := make([]uint32, 0, count)
	for i := uint32(0); i < count; i++ {
		pids = append(pids, infos[i].Process.ProcessId)
	}
	return pids
}
