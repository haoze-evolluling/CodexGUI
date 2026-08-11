package backend

import (
	"errors"
	"syscall"
	"unsafe"
)

const credentialTypeGeneric = 1
const credentialPersistLocalMachine = 2

type nativeCredential struct {
	Flags              uint32
	Type               uint32
	TargetName         *uint16
	Comment            *uint16
	LastWritten        syscall.Filetime
	CredentialBlobSize uint32
	CredentialBlob     *byte
	Persist            uint32
	AttributeCount     uint32
	Attributes         uintptr
	TargetAlias        *uint16
	UserName           *uint16
}

var advapi = syscall.NewLazyDLL("advapi32.dll")
var credWrite = advapi.NewProc("CredWriteW")
var credRead = advapi.NewProc("CredReadW")
var credDelete = advapi.NewProc("CredDeleteW")
var credFree = advapi.NewProc("CredFree")

func credentialTarget(id string) string { return "CodexGUI/provider/" + id }
func saveSecret(id, value string) error {
	target, err := syscall.UTF16PtrFromString(credentialTarget(id))
	if err != nil {
		return err
	}
	data := []byte(value)
	var ptr *byte
	if len(data) > 0 {
		ptr = &data[0]
	}
	c := nativeCredential{Type: credentialTypeGeneric, TargetName: target, CredentialBlobSize: uint32(len(data)), CredentialBlob: ptr, Persist: credentialPersistLocalMachine}
	r, _, e := credWrite.Call(uintptr(unsafe.Pointer(&c)), 0)
	if r == 0 {
		return e
	}
	return nil
}
func readSecret(id string) (string, error) {
	target, err := syscall.UTF16PtrFromString(credentialTarget(id))
	if err != nil {
		return "", err
	}
	var credential *nativeCredential
	r, _, e := credRead.Call(uintptr(unsafe.Pointer(target)), credentialTypeGeneric, 0, uintptr(unsafe.Pointer(&credential)))
	if r == 0 {
		return "", e
	}
	defer credFree.Call(uintptr(unsafe.Pointer(credential)))
	if credential.CredentialBlob == nil {
		return "", nil
	}
	return string(unsafe.Slice(credential.CredentialBlob, credential.CredentialBlobSize)), nil
}
func removeSecret(id string) error {
	target, err := syscall.UTF16PtrFromString(credentialTarget(id))
	if err != nil {
		return err
	}
	r, _, e := credDelete.Call(uintptr(unsafe.Pointer(target)), credentialTypeGeneric, 0)
	if r == 0 && e != syscall.Errno(1168) {
		return e
	}
	return nil
}
func ensureSecret(id, value string) error {
	if id == "" {
		return errors.New("提供商 ID 不能为空")
	}
	return saveSecret(id, value)
}
