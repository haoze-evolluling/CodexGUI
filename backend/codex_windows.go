//go:build windows

package backend

import (
	"os/exec"
	"syscall"
)

// configureCodexCommand keeps the helper process out of the user's desktop.
// This is especially important for npm's codex.cmd shim, which is hosted by cmd.exe.
func configureCodexCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
