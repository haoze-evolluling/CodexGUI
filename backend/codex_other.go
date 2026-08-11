//go:build !windows

package backend

import "os/exec"

func configureCodexCommand(_ *exec.Cmd) {}
