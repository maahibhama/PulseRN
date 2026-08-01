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
frames, lazily inspect and search scopes, see inline paused values, add watches, and configure
exception pausing. Hover an identifier or property chain while paused to evaluate it in the selected
call frame. Hover evaluation does not automatically invoke function calls or getters.

The resizable bottom drawer contains a live debugger console. `Enter` evaluates JavaScript,
`Shift+Enter` creates a multiline expression, Up/Down navigates the bounded local history, and
`Cmd/Ctrl+Space` suggests names from the selected frame's scopes. Results and nested properties load
lazily. Console expressions run in the selected call frame while paused and in the runtime context
while running. Captured application logs remain in the separate **Console** inspector.

Unsupported optional CDP methods disable only their corresponding control.

Breakpoints, watches, and pause-on-exception preference are saved in PulseRN's local user-data
directory and restored after Metro or the application reloads. PulseRN makes five bounded reconnect
attempts when the active Hermes target reloads and restores verified breakpoints when scripts return.

## React components and profiler

The **Components** workbench reads the attached development runtime's React DevTools Fiber roots and
shows the rendered owner hierarchy, props, class state, hooks, styles, accessibility metadata,
native tags, source locations, and the current render duration when React exposes them. **Open
source** returns to the original source debugger.

Component identities are derived from their renderer and keyed tree path, so selection survives
ordinary refreshes. PulseRN compares successive snapshots and marks changed props, state, and hooks,
tracks observed render counts, and provides **Rendered by** owner navigation.

When the embedded React DevTools agent exposes React Native inspection events, hovering a component
highlights its host view on the device. **Select on device** opens React Native's native inspection
overlay; tap a view to select the matching PulseRN component. These controls are capability-gated
because React Native embeds a version-matched React DevTools backend. Unsupported versions remain
fully usable in read-only tree mode.

The **Profiler** workbench can capture a point-in-time rank or record bounded Fiber timing samples.
These values describe JavaScript/React render work; they are not native CPU, UI-thread, or native
memory measurements. Component data is read-only and remains on the local computer.

## Example

Open `debugger-demo.ts` from either example application. Set a breakpoint inside
`calculateLineTotal`, then press **Run line debugger demo** in the app. The example includes a loop,
nested functions, an awaited promise, and a caught exception. Use **Throw debugger exception** to
exercise uncaught exception pausing.

Production builds, JavaScriptCore, native Swift/Kotlin/C++ code, simultaneous target debugging,
source editing, prop/state mutation, and guaranteed component metadata in optimized production
bundles are not supported.
