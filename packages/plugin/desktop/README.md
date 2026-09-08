# Manual desktop binary install

The plugin auto-resolves the native pet binary from the npm platform package
matching your OS/arch. If it's missing (e.g. offline install), drop a binary
here instead — this directory takes priority over nothing; resolution order is:

1. npm platform package `@jadyssey/<platform>-<arch>` (bin/desk-whale[.exe])
2. this `desktop/` directory inside the installed plugin package
3. `~/.dsh/desk-pet/desktop/` (user-wide manual location)

Expected filenames per platform:

| Platform | File(s) |
|---|---|
| Windows | `desk-whale.exe` |
| macOS | `Desk Whale.app/` (bundle) or `desk-whale` (raw binary) |
| Linux | `desk-whale` (raw binary; AppImage needs libfuse2 and is not used for spawn) |

Get binaries from the GitHub Releases page of the project.
