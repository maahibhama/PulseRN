# JavaScript debugger

PulseRN can attach its native Sources debugger to one React Native Hermes development runtime at a
time. React Native 0.76 or newer is required; the included Expo and Community CLI examples use
React Native 0.86.2.

## Connect

1. Start Metro and the development build.
2. Start PulseRN and open **Settings → Debugger** if Metro does not use port `8081`.
3. Open **Debugger**, choose **Refresh targets**, and select the Hermes runtime.
4. Close React Native DevTools first if PulseRN reports HTTP 401 or that another debugger owns the
   runtime. PulseRN distinguishes those conflicts from target reloads and ordinary disconnects.

Metro must run on the same computer as PulseRN. The debugger endpoint is restricted to loopback
addresses. The SDK event connection on port `9090` remains independent and continues feeding the
other PulseRN inspectors.

## Breakpoints and stepping

Choose an original TypeScript or JavaScript source file and click its line-number gutter to add a
breakpoint. Shift-click adds a conditional breakpoint, Cmd/Ctrl-click adds a hit-count breakpoint,
and Option/Alt-click adds a logpoint. Verified, pending, and hit-count states appear in the
breakpoint list. When execution pauses:

- `F8` resumes or pauses.
- `F10` steps over.
- `F11` steps into.
- `Shift+F11` steps out.

Use `Cmd/Ctrl+P` for quick source search. Sources are grouped by path and dependencies can be
blackboxed when Hermes supports the optional CDP method. Use the right sidebar to change call
frames, lazily inspect and search scopes, see inline paused values, add watches, evaluate an
expression, and configure exception pausing. Unsupported optional CDP methods disable only their
corresponding control.

Breakpoints, watches, and pause-on-exception preference are saved in PulseRN's local user-data
directory and restored after Metro or the application reloads. PulseRN makes five bounded reconnect
attempts when the active Hermes target reloads and restores verified breakpoints when scripts return.

## Example

Open `debugger-demo.ts` from either example application. Set a breakpoint inside
`calculateLineTotal`, then press **Run line debugger demo** in the app. The example includes a loop,
nested functions, an awaited promise, and a caught exception. Use **Throw debugger exception** to
exercise uncaught exception pausing.

Production builds, JavaScriptCore, native Swift/Kotlin/C++ code, simultaneous target debugging, and
source editing are not supported.
