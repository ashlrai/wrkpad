# macOS background service

Provider hooks are useful only while HASP is available. `wrkpad service` manages an opt-in per-user LaunchAgent at `~/Library/LaunchAgents/dev.wrkpad.hasp.plist`; it never creates a root daemon.

## Install from a stable binary

Use a stable installed binary, not a Cargo build artifact that can disappear:

```bash
wrkpad init
wrkpad service status
wrkpad service plan --action install --json
wrkpad service install --confirm <exact-plan-id>
wrkpad service status
```

The confirmation binds the existing plist hash, exact proposed plist, canonical executable path, and executable SHA-256. Installation uses only direct `/bin/launchctl` arguments, starts `wrkpad serve --bind 127.0.0.1:43187`, and requires an authenticated HASP response. If activation fails, wrkpad unloads the new job and restores the prior plist.

The plist contains no token, environment, shell, or arbitrary command. It sends stdout to `/dev/null`, stderr to the private wrkpad data directory, uses umask `077`, and restarts only after unsuccessful exit. Custom `WRKPAD_HOME` and endpoint values are refused because launchd and provider hooks would not reliably inherit them.

## Lifecycle

Every mutation needs its matching fresh plan ID:

```bash
wrkpad service plan --action restart --json
wrkpad service restart --confirm <exact-plan-id>

wrkpad service plan --action stop --json
wrkpad service stop --confirm <exact-plan-id>

wrkpad service plan --action uninstall --json
wrkpad service uninstall --confirm <exact-plan-id>
```

`repair` replaces only a recognized wrkpad plist. Foreign or symlinked targets are refused. A persistently disabled label must be enabled manually; wrkpad will not override that choice. An already-running authenticated listener that launchd does not own must be stopped before install, repair, or start.

Uninstall unloads the job and removes only the owned plist. It preserves the binary, token, status state, logs, backups, and provider hooks. Remaining hooks then fail open until the service is reinstalled or those hooks are uninstalled separately.

Service installation does not prove provider trust, hook invocation, device presence, or physical lighting.
