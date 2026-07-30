import Editor, { loader, type Monaco, type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as MonacoTypes from 'monaco-editor';
import * as bundledMonaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import type { DebuggerProperty, DebuggerState } from '../../preload/api.js';

(self as typeof self & { MonacoEnvironment: MonacoTypes.Environment }).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    return label === 'typescript' || label === 'javascript'
      ? new TypeScriptWorker()
      : new EditorWorker();
  },
};
loader.config({ monaco: bundledMonaco });

const initialState: DebuggerState = {
  status: 'disconnected',
  targets: [],
  sources: [],
  breakpoints: [],
  callFrames: [],
  watches: [],
  pauseOnExceptions: 'none',
};

function valueText(value: { description: string; type: string }): string {
  return value.description || value.type;
}

export function DebuggerPanel({ theme }: { theme: 'dark' | 'light' }) {
  const api = window.pulseRN;
  const [state, setState] = useState(initialState);
  const [sourceId, setSourceId] = useState<string>();
  const [sourceText, setSourceText] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');
  const [showInternal, setShowInternal] = useState(false);
  const [scopeProperties, setScopeProperties] = useState<Record<string, DebuggerProperty[]>>({});
  const [watchExpression, setWatchExpression] = useState('');
  const [evaluation, setEvaluation] = useState('');
  const [evaluationResult, setEvaluationResult] = useState('');
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | undefined>(undefined);
  const monacoRef = useRef<Monaco | undefined>(undefined);
  const toggleBreakpointRef = useRef<(line: number, conditional: boolean) => Promise<void>>(
    async () => undefined,
  );

  useEffect(() => {
    void api.getDebuggerState().then(setState);
    return api.onDebuggerState(setState);
  }, [api]);

  const run = useCallback(async (operation: () => Promise<DebuggerState>) => {
    setBusy(true);
    try {
      setState(await operation());
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setBusy(false);
    }
  }, []);

  const sources = useMemo(
    () =>
      state.sources.filter(
        (source) =>
          (showInternal || !source.internal) &&
          (!sourceSearch || source.url.toLowerCase().includes(sourceSearch.toLowerCase())),
      ),
    [showInternal, sourceSearch, state.sources],
  );
  const selectedSource = state.sources.find((source) => source.id === sourceId);

  useEffect(() => {
    if (!sourceId) {
      setSourceText('');
      return;
    }
    let active = true;
    void api
      .getDebuggerSource(sourceId)
      .then((value) => {
        if (active) setSourceText(value);
      })
      .catch((error) => {
        if (active) setSourceText(`// ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      active = false;
    };
  }, [api, sourceId]);

  useEffect(() => {
    const frame = state.callFrames.find((entry) => entry.id === state.selectedCallFrameId);
    if (frame) setSourceId(frame.location.sourceId);
  }, [state.callFrames, state.selectedCallFrameId]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !sourceId) return;
    const breakpoints = state.breakpoints.filter((entry) => entry.sourceId === sourceId);
    const frame = state.callFrames.find((entry) => entry.id === state.selectedCallFrameId);
    const decorations: MonacoTypes.editor.IModelDeltaDecoration[] = breakpoints.map(
      (breakpoint) => ({
        range: new monaco.Range(breakpoint.line, 1, breakpoint.line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: breakpoint.verified
            ? 'debugger-breakpoint-glyph'
            : 'debugger-breakpoint-glyph pending',
          glyphMarginHoverMessage: {
            value: breakpoint.condition
              ? `Conditional breakpoint: \`${breakpoint.condition}\``
              : breakpoint.error || 'Breakpoint',
          },
        },
      }),
    );
    if (frame?.location.sourceId === sourceId) {
      decorations.push({
        range: new monaco.Range(frame.location.line, 1, frame.location.line, 1),
        options: {
          isWholeLine: true,
          className: 'debugger-current-line',
          glyphMarginClassName: 'debugger-current-glyph',
        },
      });
      editor.revealLineInCenter(frame.location.line);
      editor.setPosition({ lineNumber: frame.location.line, column: frame.location.column });
    }
    const collection = editor.createDecorationsCollection(decorations);
    return () => collection.clear();
  }, [sourceId, state.breakpoints, state.callFrames, state.selectedCallFrameId]);

  const toggleBreakpoint = useCallback(
    async (line: number, conditional: boolean) => {
      if (!sourceId) return;
      const existing = state.breakpoints.find(
        (entry) => entry.sourceId === sourceId && entry.line === line,
      );
      if (existing) {
        await run(() => api.removeDebuggerBreakpoint(existing.id));
        return;
      }
      const condition = conditional
        ? window.prompt('Pause only when this expression is true:')?.trim()
        : undefined;
      if (conditional && !condition) return;
      await run(() =>
        api.addDebuggerBreakpoint({ sourceId, line, column: 1, condition: condition || undefined }),
      );
    },
    [api, run, sourceId, state.breakpoints],
  );

  const onMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.onMouseDown((event) => {
      if (
        event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        event.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
      ) {
        const line = event.target.position?.lineNumber;
        if (line) void toggleBreakpointRef.current(line, event.event.browserEvent.shiftKey);
      }
    });
  }, []);
  toggleBreakpointRef.current = toggleBreakpoint;

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'F8') {
        event.preventDefault();
        void run(() => api.debuggerCommand(state.status === 'paused' ? 'resume' : 'pause'));
      } else if (event.key === 'F10') {
        event.preventDefault();
        void run(() => api.debuggerCommand('stepOver'));
      } else if (event.key === 'F11' && event.shiftKey) {
        event.preventDefault();
        void run(() => api.debuggerCommand('stepOut'));
      } else if (event.key === 'F11') {
        event.preventDefault();
        void run(() => api.debuggerCommand('stepInto'));
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [api, run, state.status]);

  async function loadScope(objectId: string): Promise<void> {
    if (scopeProperties[objectId]) return;
    try {
      const properties = await api.getDebuggerScope(objectId);
      setScopeProperties((current) => ({ ...current, [objectId]: properties }));
    } catch {
      setScopeProperties((current) => ({ ...current, [objectId]: [] }));
    }
  }

  const connected = state.status === 'connected' || state.status === 'paused';
  const paused = state.status === 'paused';

  return (
    <>
      <main className="debugger-panel">
        <header className="debugger-toolbar">
          <button disabled={busy} onClick={() => void run(() => api.discoverDebuggerTargets())}>
            Refresh targets
          </button>
          <select
            aria-label="Hermes target"
            value={state.activeTargetId ?? ''}
            onChange={(event) => {
              const targetId = event.target.value;
              if (targetId) void run(() => api.connectDebugger(targetId));
            }}
          >
            <option value="">Select Hermes target…</option>
            {state.targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.title} {target.deviceName ? `· ${target.deviceName}` : ''}
              </option>
            ))}
          </select>
          <span className={`debugger-status ${connected ? 'online' : ''}`}>{state.status}</span>
          <div className="debugger-controls">
            <button
              disabled={!connected}
              title={paused ? 'Resume (F8)' : 'Pause (F8)'}
              onClick={() => void run(() => api.debuggerCommand(paused ? 'resume' : 'pause'))}
            >
              {paused ? '▶' : 'Ⅱ'}
            </button>
            <button
              disabled={!paused}
              title="Step over (F10)"
              onClick={() => void run(() => api.debuggerCommand('stepOver'))}
            >
              ↷
            </button>
            <button
              disabled={!paused}
              title="Step into (F11)"
              onClick={() => void run(() => api.debuggerCommand('stepInto'))}
            >
              ↓
            </button>
            <button
              disabled={!paused}
              title="Step out (Shift+F11)"
              onClick={() => void run(() => api.debuggerCommand('stepOut'))}
            >
              ↑
            </button>
            <button disabled={!connected} onClick={() => void run(() => api.disconnectDebugger())}>
              Disconnect
            </button>
          </div>
        </header>
        {state.error && <div className="debugger-banner">{state.error}</div>}
        <div className="debugger-workspace">
          <aside className="source-browser">
            <input
              aria-label="Search sources"
              placeholder="Search files…"
              value={sourceSearch}
              onChange={(event) => setSourceSearch(event.target.value)}
            />
            <label>
              <input
                checked={showInternal}
                type="checkbox"
                onChange={(event) => setShowInternal(event.target.checked)}
              />
              Show internal sources
            </label>
            <div>
              {sources.map((source) => (
                <button
                  className={source.id === sourceId ? 'active' : ''}
                  key={source.id}
                  title={source.url}
                  onClick={() => setSourceId(source.id)}
                >
                  <span>{source.name}</span>
                  <small>{source.original ? 'TS' : 'JS'}</small>
                </button>
              ))}
            </div>
          </aside>
          <section className="source-editor">
            <div className="source-title">
              {selectedSource?.url ?? 'Connect and choose a source file'}
            </div>
            <Editor
              height="100%"
              language={
                selectedSource?.name.endsWith('.tsx')
                  ? 'typescript'
                  : selectedSource?.name.endsWith('.ts')
                    ? 'typescript'
                    : 'javascript'
              }
              loading="Loading source editor…"
              onMount={onMount}
              options={{
                readOnly: true,
                glyphMargin: true,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbersMinChars: 3,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
              path={selectedSource?.url}
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              value={sourceText}
            />
          </section>
        </div>
      </main>
      <aside className="debugger-sidebar">
        <section>
          <header>
            <strong>Call stack</strong>
            {state.pauseReason && <small>{state.pauseReason}</small>}
          </header>
          <div className="debugger-list">
            {state.callFrames.map((frame) => (
              <button
                className={frame.id === state.selectedCallFrameId ? 'active' : ''}
                key={frame.id}
                onClick={() => void run(() => api.selectDebuggerCallFrame(frame.id))}
              >
                <strong>{frame.functionName}</strong>
                <small>
                  {state.sources.find((source) => source.id === frame.location.sourceId)?.name ??
                    frame.location.sourceId}
                  :{frame.location.line}
                </small>
              </button>
            ))}
            {!paused && <p>Pause execution to inspect frames.</p>}
          </div>
        </section>
        <section>
          <header>
            <strong>Scopes</strong>
          </header>
          <div className="scope-list">
            {state.callFrames
              .find((frame) => frame.id === state.selectedCallFrameId)
              ?.scopes.map((scope, index) => (
                <details
                  key={`${scope.type}-${index}`}
                  onToggle={(event) => {
                    if (event.currentTarget.open && scope.objectId) void loadScope(scope.objectId);
                  }}
                >
                  <summary>{scope.name || scope.type}</summary>
                  {scope.objectId &&
                    (scopeProperties[scope.objectId] ?? []).map((property) => (
                      <div className="debugger-property" key={property.name}>
                        <span>{property.name}</span>
                        <code title={valueText(property.value)}>{valueText(property.value)}</code>
                      </div>
                    ))}
                </details>
              ))}
          </div>
        </section>
        <section>
          <header>
            <strong>Watch</strong>
          </header>
          <form
            className="debugger-input"
            onSubmit={(event) => {
              event.preventDefault();
              const expression = watchExpression;
              setWatchExpression('');
              void run(() => api.addDebuggerWatch(expression));
            }}
          >
            <input
              disabled={!paused}
              placeholder="Add expression…"
              value={watchExpression}
              onChange={(event) => setWatchExpression(event.target.value)}
            />
          </form>
          <div className="watch-list">
            {state.watches.map((watch) => (
              <div key={watch.id}>
                <span>{watch.expression}</span>
                <code title={watch.error ?? watch.result?.description}>
                  {watch.error ?? watch.result?.description ?? 'Not paused'}
                </code>
                <button onClick={() => void run(() => api.removeDebuggerWatch(watch.id))}>×</button>
              </div>
            ))}
          </div>
        </section>
        <section>
          <header>
            <strong>Console evaluation</strong>
          </header>
          <form
            className="debugger-input"
            onSubmit={(event) => {
              event.preventDefault();
              void api
                .evaluateDebuggerExpression(evaluation)
                .then((result) => setEvaluationResult(result.description))
                .catch((error) =>
                  setEvaluationResult(error instanceof Error ? error.message : String(error)),
                );
            }}
          >
            <input
              disabled={!paused}
              placeholder="Evaluate while paused…"
              value={evaluation}
              onChange={(event) => setEvaluation(event.target.value)}
            />
          </form>
          {evaluationResult && <pre>{evaluationResult}</pre>}
        </section>
        <section className="pause-exceptions">
          <label>
            Pause on exceptions
            <select
              value={state.pauseOnExceptions}
              onChange={(event) =>
                void run(() =>
                  api.setPauseOnExceptions(
                    event.target.value as DebuggerState['pauseOnExceptions'],
                  ),
                )
              }
            >
              <option value="none">None</option>
              <option value="uncaught">Uncaught</option>
              <option value="all">All</option>
            </select>
          </label>
        </section>
        <section>
          <header>
            <strong>Breakpoints</strong>
          </header>
          <div className="breakpoint-list">
            {state.breakpoints.map((breakpoint) => (
              <div key={breakpoint.id}>
                <input
                  checked={breakpoint.enabled}
                  type="checkbox"
                  onChange={(event) =>
                    void run(() =>
                      api.setDebuggerBreakpointEnabled(breakpoint.id, event.target.checked),
                    )
                  }
                />
                <button onClick={() => setSourceId(breakpoint.sourceId)}>
                  {state.sources.find((source) => source.id === breakpoint.sourceId)?.name ??
                    breakpoint.sourceId}
                  :{breakpoint.line}
                </button>
                <span title={breakpoint.error}>{breakpoint.verified ? '●' : '○'}</span>
              </div>
            ))}
          </div>
          <small className="debugger-hint">Shift-click a line number for a condition.</small>
        </section>
      </aside>
    </>
  );
}
