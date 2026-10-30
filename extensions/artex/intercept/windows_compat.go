// Windows compatibility shims for the static shell-capture layer.
//
// The capture layer pins "trusted" tool implementations to their canonical
// POSIX locations (/bin, /usr/bin) so a static simulation (e.g. the sed
// snapshot) only runs against the real system tool. Windows has no canonical
// tool paths, and Windows LookPath cannot resolve POSIX-style
// extension-less interpreter names. These helpers restore equivalent
// guarantees on Windows without changing any POSIX behavior: tools must live
// inside a Git for Windows / MSYS2 distribution bin directory and must be a
// native ELF/PE image (nativeInterpreterFile).
package intercept

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"mvdan.cc/sh/v3/expand"
)

// expandEnvironment builds an expand.Environ for the inline-variant
// expansion. mvdan/sh's ListEnviron uppercases every variable name on
// Windows (mirroring the Win32 environment), which silently breaks
// case-sensitive shell variables such as loop variables; an exact lookup
// keeps the POSIX case-sensitive semantics on every platform.
func expandEnvironment(pairs ...string) expand.Environ {
	lookup := make(map[string]string, len(pairs))
	for _, pair := range pairs {
		if sep := strings.IndexByte(pair, '='); sep > 0 {
			lookup[pair[:sep]] = pair[sep+1:]
		}
	}
	return expand.FuncEnviron(func(name string) string {
		return lookup[name]
	})
}

// trustedWindowsToolDirs are bin-directory structures (lowercase,
// backslash separated) that ship the MSYS2/Git-for-Windows toolchain.
var trustedWindowsToolBins = []string{
	`\usr\bin\`,
	`\mingw64\bin\`,
	`\mingw32\bin\`,
}

// trustedWindowsToolDir reports whether the resolved executable is
// <base>.exe inside a distribution bin directory of a Git for Windows or
// MSYS2 installation. Because those distributions may be installed (or run
// portable) under arbitrary names, the check accepts any ancestor directory
// whose name contains "git" or starts with "msys" as the distribution root
// marker; the file itself must still be a native interpreter image.
func trustedWindowsToolDir(executable, base string) bool {
	if !strings.EqualFold(filepath.Base(executable), base+".exe") {
		return false
	}
	lower := strings.ToLower(executable)
	structured := false
	for _, fragment := range trustedWindowsToolBins {
		if strings.Contains(lower, fragment) {
			structured = true
			break
		}
	}
	if !structured {
		return false
	}
	for _, segment := range strings.Split(lower, `\`) {
		if segment == "" {
			continue
		}
		if strings.Contains(segment, "git") || strings.HasPrefix(segment, "msys") {
			return true
		}
	}
	return false
}

// resolveTrustedTool resolves the reviewed command name to the trusted native
// implementation of base ("sed", "cat", "mkdir", "chmod"). On POSIX the
// resolved path must be the canonical /bin/<base> or /usr/bin/<base>. On
// Windows only Git for Windows / MSYS2 distribution directories are accepted.
// Both paths require a native interpreter image.
func resolveTrustedTool(name, base string) (string, bool) {
	if runtime.GOOS != "windows" {
		if name != base && name != "/bin/"+base && name != "/usr/bin/"+base {
			return "", false
		}
		executable, err := exec.LookPath(name)
		if err != nil {
			return "", false
		}
		executable, err = filepath.EvalSymlinks(executable)
		if err != nil || (executable != "/bin/"+base && executable != "/usr/bin/"+base) || !nativeInterpreterFile(executable) {
			return "", false
		}
		return executable, true
	}
	if name != base {
		return "", false
	}
	executable, err := exec.LookPath(name)
	if err != nil {
		return "", false
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil || !trustedWindowsToolDir(executable, base) || !nativeInterpreterFile(executable) {
		return "", false
	}
	return executable, true
}

// scanPathForNative finds name verbatim (no extension inference) in the
// PATH-style search list, accepting relative entries only when dir is known.
// Windows LookPath only resolves extension-bearing executables, so the Python
// interpreter resolution uses this fallback there; the ELF/PE magic check in
// nativeInterpreterFile still rejects anything that is not a native binary.
func scanPathForNative(name, searchPath, dir string) string {
	for _, entry := range filepath.SplitList(searchPath) {
		if entry == "" {
			continue
		}
		if !filepath.IsAbs(entry) {
			if dir == "" {
				continue
			}
			entry = filepath.Join(dir, entry)
		}
		candidate := filepath.Join(entry, name)
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate
		}
	}
	return ""
}
