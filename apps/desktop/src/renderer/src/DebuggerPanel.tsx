import Editor, { loader, type EditorProps, type Monaco, type OnMount } from '@monaco-editor/react';
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as MonacoTypes from 'monaco-editor';
import * as bundledMonaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import type {
  ThemeDefinition,
  DebuggerEvaluation,
  DebuggerProperty,
  DebuggerRemoteValue,
  DebuggerState,
  ReactComponentNode,
  ReactComponentSnapshot,
} from '../../preload/api.js';

(self as typeof self & { MonacoEnvironment: MonacoTypes.Environment }).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    return label === 'typescript' || label === 'javascript'
      ? new TypeScriptWorker()
      : new EditorWorker();
  },
};
loader.config({ monaco: bundledMonaco });
// @monaco-editor/react currently resolves a different ReactNode declaration in some
// pnpm installations. Its runtime component and EditorProps remain compatible.
const MonacoEditor = Editor as unknown as ComponentType<EditorProps>;

const initialState: DebuggerState = {
  status: 'disconnected',
  targets: [],
  sources: [],
  breakpoints: [],
  callFrames: [],
  watches: [],
  pauseOnExceptions: 'none',
  blackboxInternal: true,
  capabilities: {
    asyncStacks: false,
    pauseOnExceptions: false,
    blackboxing: false,
    logpoints: false,
  },
};

function valueText(value: { description: string; type: string }): string {
  return value.description || value.type;
}

function RemoteValueView({
  value,
  compact = false,
}: {
  value: DebuggerRemoteValue;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [properties, setProperties] = useState<DebuggerProperty[]>();
  const [error, setError] = useState('');
  const expandable = Boolean(value.objectId);

  useEffect(() => {
    if (!expanded || !value.objectId || properties) return;
    let active = true;
    void window.pulseRN
      .getDebuggerProperties(value.objectId)
      .then((next) => {
        if (active) setProperties(next);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [expanded, properties, value.objectId]);

  return (
    <span className={`debugger-remote-value ${compact ? 'compact' : ''}`}>
      {expandable && (
        <button
          aria-label={expanded ? 'Collapse value' : 'Expand value'}
          className="debugger-disclosure"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '▾' : '▸'}
        </button>
      )}
      <code className={`value-${value.type}`} title={valueText(value)}>
        {valueText(value)}
      </code>
      {!expanded && value.preview && value.preview.properties.length > 0 && (
        <span className="debugger-preview">
          {' '}
          {'{ '}
          {value.preview.properties
            .slice(0, 4)
            .map((property) => `${property.name}: ${property.value ?? property.type}`)
            .join(', ')}
          {value.preview.overflow ? ', …' : ''} {' }'}
        </span>
      )}
      {expanded && (
        <span className="debugger-object-properties">
          {error && <span className="debugger-value-error">{error}</span>}
          {!properties && !error && <span>Loading…</span>}
          {properties?.map((property) => (
            <span key={property.name}>
              <strong>{property.name}</strong>
              {property.accessor ? (
                <em>Getter (not evaluated)</em>
              ) : (
                <RemoteValueView compact value={property.value} />
              )}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

const emptyComponentSnapshot: ReactComponentSnapshot = {
  available: false,
  rendererCount: 0,
  roots: [],
  nodes: [],
  truncated: false,
  capturedAt: 0,
  capabilities: { highlight: false, pick: false },
};

export function DebuggerPanel({
  theme,
  appearanceTheme,
  codeFontFamily,
}: {
  theme: 'dark' | 'light';
  appearanceTheme?: ThemeDefinition;
  codeFontFamily?: string;
}) {
  const api = window.pulseRN;
  const [state, setState] = useState(initialState);
  const [sourceId, setSourceId] = useState<string>();
  const [sourceText, setSourceText] = useState('');
  const [requestedSourceLine, setRequestedSourceLine] = useState<number>();
  const [sourceSearch, setSourceSearch] = useState('');
  const [showInternal, setShowInternal] = useState(false);
  const [scopeProperties, setScopeProperties] = useState<Record<string, DebuggerProperty[]>>({});
  const [variableSearch, setVariableSearch] = useState('');
  const [watchExpression, setWatchExpression] = useState('');
  const [evaluation, setEvaluation] = useState('');
  const [consoleEntries, setConsoleEntries] = useState<DebuggerEvaluation[]>([]);
  const [consoleHistory, setConsoleHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showCompletions, setShowCompletions] = useState(false);
  const [bottomTab, setBottomTab] = useState<'console' | 'watch' | 'breakpoints'>('console');
  const [bottomOpen, setBottomOpen] = useState(true);
  const [sideTab, setSideTab] = useState<'frames' | 'variables' | 'watch' | 'breakpoints'>(
    'frames',
  );
  const [workbench, setWorkbench] = useState<'sources' | 'components' | 'profiler'>('sources');
  const [componentSnapshot, setComponentSnapshot] =
    useState<ReactComponentSnapshot>(emptyComponentSnapshot);
  const [componentSearch, setComponentSearch] = useState('');
  const [selectedComponentId, setSelectedComponentId] = useState<string>();
  const [componentBusy, setComponentBusy] = useState(false);
  const [componentPicking, setComponentPicking] = useState(false);
  const [componentInteractionError, setComponentInteractionError] = useState('');
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | undefined>(undefined);
  const monacoRef = useRef<Monaco | undefined>(undefined);
  const editorThemeName = appearanceTheme
    ? `pulsern-${appearanceTheme.id}`
    : theme === 'dark'
      ? 'vs-dark'
      : 'light';
  useEffect(() => {
    if (!appearanceTheme || !monacoRef.current) return;
    monacoRef.current.editor.defineTheme(editorThemeName, {
      base: appearanceTheme.colorScheme === 'dark' ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': appearanceTheme.colors.codeBackground,
        'editor.foreground': appearanceTheme.colors.text,
        'editor.selectionBackground': appearanceTheme.colors.selection,
        'editorLineNumber.foreground': appearanceTheme.colors.muted,
      },
    });
    monacoRef.current.editor.setTheme(editorThemeName);
  }, [appearanceTheme, editorThemeName]);
  const sourceSearchRef = useRef<HTMLInputElement | null>(null);
  const toggleBreakpointRef = useRef<
    (line: number, mode: 'plain' | 'condition' | 'hit' | 'log') => Promise<void>
  >(async () => undefined);
  const pausedRef = useRef(false);
  const selectedFrameRef = useRef<string | undefined>(undefined);
  const previousInlineValuesRef = useRef('');
  const componentCaptureRef = useRef(false);

  useEffect(() => {
    void api.getDebuggerState().then(setState);
    return api.onDebuggerState(setState);
  }, [api]);
  useEffect(() => {
    try {
      const history = JSON.parse(localStorage.getItem('pulsern.debugger.console-history') ?? '[]');
      if (Array.isArray(history)) {
        setConsoleHistory(
          history.filter((value): value is string => typeof value === 'string').slice(0, 100),
        );
      }
      const layout = JSON.parse(localStorage.getItem('pulsern.debugger.layout') ?? '{}') as {
        bottomOpen?: boolean;
        bottomTab?: 'console' | 'watch' | 'breakpoints';
        sideTab?: 'frames' | 'variables' | 'watch' | 'breakpoints';
      };
      if (typeof layout.bottomOpen === 'boolean') setBottomOpen(layout.bottomOpen);
      if (layout.bottomTab) setBottomTab(layout.bottomTab);
      if (layout.sideTab) setSideTab(layout.sideTab);
    } catch {
      // Ignore stale local debugger layout preferences.
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(
      'pulsern.debugger.console-history',
      JSON.stringify(consoleHistory.slice(0, 100)),
    );
  }, [consoleHistory]);
  useEffect(() => {
    localStorage.setItem(
      'pulsern.debugger.layout',
      JSON.stringify({ bottomOpen, bottomTab, sideTab }),
    );
  }, [bottomOpen, bottomTab, sideTab]);
  pausedRef.current = state.status === 'paused';
  selectedFrameRef.current = state.selectedCallFrameId;

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
  const sourceGroups = useMemo(() => {
    const groups = new Map<string, typeof sources>();
    for (const source of sources) {
      const group = source.group ?? 'Application';
      groups.set(group, [...(groups.get(group) ?? []), source]);
    }
    return [...groups.entries()];
  }, [sources]);

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
      const firstScope = frame.scopes.find((scope) => scope.objectId);
      const inlineValues = firstScope?.objectId
        ? (scopeProperties[firstScope.objectId] ?? [])
            .filter((property) => !variableSearch || property.name.includes(variableSearch))
            .slice(0, 4)
            .map((property) => `${property.name} = ${valueText(property.value)}`)
            .join(' · ')
        : '';
      const changed =
        Boolean(previousInlineValuesRef.current) &&
        previousInlineValuesRef.current !== inlineValues;
      previousInlineValuesRef.current = inlineValues;
      decorations.push({
        range: new monaco.Range(frame.location.line, 1, frame.location.line, 1),
        options: {
          isWholeLine: true,
          className: 'debugger-current-line',
          glyphMarginClassName: 'debugger-current-glyph',
          ...(inlineValues
            ? {
                after: {
                  content: `  // ${changed ? 'changed · ' : ''}${inlineValues}`,
                  inlineClassName: changed
                    ? 'debugger-inline-values changed'
                    : 'debugger-inline-values',
                },
              }
            : {}),
        },
      });
      editor.revealLineInCenter(frame.location.line);
      editor.setPosition({ lineNumber: frame.location.line, column: frame.location.column });
    }
    const collection = editor.createDecorationsCollection(decorations);
    return () => collection.clear();
  }, [
    scopeProperties,
    sourceId,
    state.breakpoints,
    state.callFrames,
    state.selectedCallFrameId,
    variableSearch,
  ]);

  useEffect(() => {
    if (!requestedSourceLine || !editorRef.current) return;
    editorRef.current.revealLineInCenter(requestedSourceLine);
    editorRef.current.setPosition({ lineNumber: requestedSourceLine, column: 1 });
    setRequestedSourceLine(undefined);
  }, [requestedSourceLine, sourceText]);

  const toggleBreakpoint = useCallback(
    async (line: number, mode: 'plain' | 'condition' | 'hit' | 'log') => {
      if (!sourceId) return;
      const existing = state.breakpoints.find(
        (entry) => entry.sourceId === sourceId && entry.line === line,
      );
      if (existing) {
        await run(() => api.removeDebuggerBreakpoint(existing.id));
        return;
      }
      const condition =
        mode === 'condition'
          ? window.prompt('Pause only when this expression is true:')?.trim()
          : undefined;
      const hitCondition =
        mode === 'hit'
          ? Number(window.prompt('Pause on which hit count?', '1')?.trim())
          : undefined;
      const logMessage =
        mode === 'log' ? window.prompt('Log this message without pausing:')?.trim() : undefined;
      if (mode === 'condition' && !condition) return;
      if (mode === 'hit' && (!Number.isInteger(hitCondition) || (hitCondition ?? 0) < 1)) return;
      if (mode === 'log' && !logMessage) return;
      await run(() =>
        api.addDebuggerBreakpoint({
          sourceId,
          line,
          column: 1,
          condition: condition || undefined,
          hitCondition,
          logMessage,
        }),
      );
    },
    [api, run, sourceId, state.breakpoints],
  );

  const onMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      editor.onMouseDown((event) => {
        if (
          event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
          event.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
        ) {
          const line = event.target.position?.lineNumber;
          if (line) {
            const browserEvent = event.event.browserEvent;
            const mode = browserEvent.altKey
              ? 'log'
              : browserEvent.metaKey || browserEvent.ctrlKey
                ? 'hit'
                : browserEvent.shiftKey
                  ? 'condition'
                  : 'plain';
            void toggleBreakpointRef.current(line, mode);
          }
        }
      });
      const provider: MonacoTypes.languages.HoverProvider = {
        provideHover: async (model, position, token) => {
          if (!pausedRef.current || token.isCancellationRequested) return undefined;
          const line = model.getLineContent(position.lineNumber);
          const offset = position.column - 1;
          const expressionPattern =
            /[A-Za-z_$][\w$]*(?:(?:\?\.)?[A-Za-z_$][\w$]*|\[(?:\d+|["'][^"'\\]{0,100}["'])\])*/g;
          let expression: string | undefined;
          let expressionStart = offset;
          for (const match of line.matchAll(expressionPattern)) {
            const start = match.index;
            const end = start + match[0].length;
            if (start <= offset && end >= offset) {
              expression = match[0];
              expressionStart = start;
              break;
            }
          }
          if (!expression) return undefined;
          try {
            const result = await api.evaluateDebuggerExpression(expression, {
              frameId: selectedFrameRef.current,
            });
            if (token.isCancellationRequested) {
              if (result.objectId) void api.releaseDebuggerObject(result.objectId);
              return undefined;
            }
            const preview = result.preview?.properties
              .slice(0, 6)
              .map((property) => `${property.name}: ${property.value ?? property.type}`)
              .join(', ');
            const hover = {
              range: new monaco.Range(
                position.lineNumber,
                expressionStart + 1,
                position.lineNumber,
                expressionStart + expression.length + 1,
              ),
              contents: [
                { value: `**${expression}**` },
                {
                  value: `\`\`\`text\n${valueText(result)}${preview ? ` { ${preview}${result.preview?.overflow ? ', …' : ''} }` : ''}\n\`\`\``,
                },
              ],
            };
            if (result.objectId) void api.releaseDebuggerObject(result.objectId);
            return hover;
          } catch (error) {
            return {
              contents: [
                { value: `**${expression}**` },
                { value: error instanceof Error ? error.message : String(error) },
              ],
            };
          }
        },
      };
      const disposables = [
        monaco.languages.registerHoverProvider('typescript', provider),
        monaco.languages.registerHoverProvider('javascript', provider),
      ];
      editor.onDidDispose(() => disposables.forEach((disposable) => disposable.dispose()));
    },
    [api],
  );
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
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        sourceSearchRef.current?.focus();
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

  useEffect(() => {
    const frame = state.callFrames.find((entry) => entry.id === state.selectedCallFrameId);
    for (const scope of frame?.scopes.slice(0, 2) ?? []) {
      if (scope.objectId) void loadScope(scope.objectId);
    }
  }, [state.callFrames, state.selectedCallFrameId]);

  const connected = state.status === 'connected' || state.status === 'paused';
  const paused = state.status === 'paused';
  const selectedComponent = componentSnapshot.nodes.find((node) => node.id === selectedComponentId);
  const visibleComponents = useMemo(() => {
    const query = componentSearch.trim().toLowerCase();
    if (!query) return componentSnapshot.nodes;
    const matches = new Set(
      componentSnapshot.nodes
        .filter(
          (node) =>
            node.name.toLowerCase().includes(query) ||
            Object.keys(node.props).some((name) => name.toLowerCase().includes(query)),
        )
        .map((node) => node.id),
    );
    for (const node of componentSnapshot.nodes) {
      if (!matches.has(node.id)) continue;
      let parentId = node.parentId;
      while (parentId) {
        matches.add(parentId);
        parentId = componentSnapshot.nodes.find((entry) => entry.id === parentId)?.parentId;
      }
    }
    return componentSnapshot.nodes.filter((node) => matches.has(node.id));
  }, [componentSearch, componentSnapshot.nodes]);
  const consoleCompletions = useMemo(() => {
    const frame = state.callFrames.find((entry) => entry.id === state.selectedCallFrameId);
    const names = new Set<string>();
    for (const scope of frame?.scopes ?? []) {
      if (!scope.objectId) continue;
      for (const property of scopeProperties[scope.objectId] ?? []) names.add(property.name);
    }
    const token = evaluation.match(/[A-Za-z_$][\w$]*$/)?.[0]?.toLowerCase() ?? '';
    return [...names]
      .filter((name) => !token || name.toLowerCase().startsWith(token))
      .sort()
      .slice(0, 12);
  }, [evaluation, scopeProperties, state.callFrames, state.selectedCallFrameId]);

  const executeConsole = useCallback(
    async (rawExpression?: string) => {
      const expression = (rawExpression ?? evaluation).trim();
      if (!expression) return;
      const entry: DebuggerEvaluation = {
        id: crypto.randomUUID(),
        expression,
        createdAt: Date.now(),
        frameId: state.selectedCallFrameId,
      };
      setEvaluation('');
      setHistoryIndex(-1);
      setConsoleHistory((current) =>
        [expression, ...current.filter((item) => item !== expression)].slice(0, 100),
      );
      setConsoleEntries((current) => [...current, entry].slice(-200));
      try {
        const result = await api.evaluateDebuggerExpression(expression, {
          frameId: state.selectedCallFrameId,
          allowRunning: true,
        });
        setConsoleEntries((current) =>
          current.map((item) => (item.id === entry.id ? { ...item, result } : item)),
        );
      } catch (error) {
        setConsoleEntries((current) =>
          current.map((item) =>
            item.id === entry.id
              ? { ...item, error: error instanceof Error ? error.message : String(error) }
              : item,
          ),
        );
      }
    },
    [api, evaluation, state.selectedCallFrameId],
  );

  const refreshComponents = useCallback(async () => {
    if (componentCaptureRef.current) return;
    componentCaptureRef.current = true;
    setComponentBusy(true);
    try {
      const snapshot = await api.getReactComponentSnapshot();
      setComponentSnapshot(snapshot);
      setSelectedComponentId((current) =>
        current && snapshot.nodes.some((node) => node.id === current)
          ? current
          : (snapshot.selectedId ?? snapshot.roots[0]),
      );
    } catch (error) {
      setComponentSnapshot({
        ...emptyComponentSnapshot,
        capturedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      componentCaptureRef.current = false;
      setComponentBusy(false);
    }
  }, [api]);

  useEffect(() => {
    if (!componentPicking) return;
    const timer = window.setInterval(() => {
      void api
        .interactWithReactComponent('pollPicked')
        .then((result) => {
          if (result.error) setComponentInteractionError(result.error);
          if (!result.selectedId) return;
          setSelectedComponentId(result.selectedId);
          setComponentPicking(false);
          void api.interactWithReactComponent('stopPicking');
          void refreshComponents();
        })
        .catch((error) =>
          setComponentInteractionError(error instanceof Error ? error.message : String(error)),
        );
    }, 300);
    return () => window.clearInterval(timer);
  }, [api, componentPicking, refreshComponents]);

  useEffect(() => {
    if ((workbench === 'components' || workbench === 'profiler') && connected) {
      void refreshComponents();
    }
  }, [connected, refreshComponents, workbench]);
  useEffect(() => {
    if (workbench === 'components') return;
    if (componentPicking) {
      setComponentPicking(false);
      void api.interactWithReactComponent('stopPicking');
    }
    if (componentSnapshot.capabilities.highlight) {
      void api.interactWithReactComponent('hideHighlight');
    }
  }, [api, componentPicking, componentSnapshot.capabilities.highlight, workbench]);

  return (
    <>
      <main className={`debugger-panel ${workbench === 'sources' ? '' : 'wide'}`}>
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
          <nav className="debugger-workbench-tabs" aria-label="Debugger workbench">
            {(['sources', 'components', 'profiler'] as const).map((tab) => (
              <button
                className={workbench === tab ? 'active' : ''}
                key={tab}
                onClick={() => setWorkbench(tab)}
              >
                {tab === 'sources' ? 'Sources' : tab === 'components' ? 'Components' : 'Profiler'}
              </button>
            ))}
          </nav>
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
        {connected && (
          <div className="debugger-capabilities">
            <span>{state.capabilities.asyncStacks ? 'Async stacks' : 'No async stacks'}</span>
            <span>
              {state.capabilities.pauseOnExceptions ? 'Exception pause' : 'No exception pause'}
            </span>
            <span>{state.capabilities.blackboxing ? 'Blackboxing' : 'No blackboxing'}</span>
            <span>{state.capabilities.logpoints ? 'Logpoints' : 'No logpoints'}</span>
          </div>
        )}
        {workbench === 'sources' && (
          <div className={`debugger-workspace ${bottomOpen ? 'with-bottom-drawer' : ''}`}>
            <aside className="source-browser">
              <input
                ref={sourceSearchRef}
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
              <label>
                <input
                  checked={state.blackboxInternal}
                  disabled={connected && !state.capabilities.blackboxing}
                  type="checkbox"
                  onChange={(event) =>
                    void run(() => api.setDebuggerBlackboxInternal(event.target.checked))
                  }
                />
                Blackbox dependencies
              </label>
              <div>
                {sourceGroups.map(([group, groupedSources]) => (
                  <details key={group} open>
                    <summary>{group}</summary>
                    {groupedSources.map((source) => (
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
                  </details>
                ))}
              </div>
            </aside>
            <section className="source-editor">
              <div className="source-title">
                {selectedSource?.url ?? 'Connect and choose a source file'}
              </div>
              <MonacoEditor
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
                  fontFamily: codeFontFamily,
                  lineNumbersMinChars: 3,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
                path={selectedSource?.url}
                theme={editorThemeName}
                value={sourceText}
              />
            </section>
          </div>
        )}
        {workbench === 'components' && (
          <div className="react-components-workspace">
            <aside className="component-tree-panel">
              <div className="component-panel-toolbar">
                <input
                  aria-label="Search components"
                  placeholder="Search components…"
                  type="search"
                  value={componentSearch}
                  onChange={(event) => setComponentSearch(event.target.value)}
                />
                <div>
                  <button
                    disabled={!connected || componentBusy}
                    onClick={() => void refreshComponents()}
                  >
                    {componentBusy ? 'Refreshing…' : 'Refresh'}
                  </button>
                  <button
                    disabled={!componentSnapshot.capabilities.pick}
                    className={componentPicking ? 'active' : ''}
                    title={
                      componentSnapshot.capabilities.pick
                        ? 'Tap a view on the connected device'
                        : 'The attached React renderer does not expose device picking'
                    }
                    onClick={() => {
                      const action = componentPicking ? 'stopPicking' : 'startPicking';
                      void api
                        .interactWithReactComponent(action)
                        .then((result) => {
                          setComponentPicking(result.active);
                          setComponentInteractionError(result.error ?? '');
                        })
                        .catch((error) =>
                          setComponentInteractionError(
                            error instanceof Error ? error.message : String(error),
                          ),
                        );
                    }}
                  >
                    {componentPicking ? 'Stop picking' : 'Select on device'}
                  </button>
                </div>
              </div>
              {componentInteractionError && (
                <div className="component-interaction-error">{componentInteractionError}</div>
              )}
              {componentSnapshot.truncated && (
                <div className="component-limit-note">
                  Showing the first 1,000 components. Use search or inspect a smaller application
                  subtree.
                </div>
              )}
              {componentSnapshot.error && (
                <div className="component-empty-state">
                  <strong>Component inspection unavailable</strong>
                  <p>{componentSnapshot.error}</p>
                  <small>
                    Use a Hermes development build with the React DevTools global hook enabled.
                  </small>
                </div>
              )}
              <div className="component-tree" role="tree">
                {visibleComponents.map((node) => (
                  <button
                    aria-selected={node.id === selectedComponentId}
                    className={node.id === selectedComponentId ? 'active' : ''}
                    key={node.id}
                    onMouseEnter={() => {
                      if (!componentSnapshot.capabilities.highlight) return;
                      void api.interactWithReactComponent('highlight', node.id).then((result) => {
                        if (result.error) setComponentInteractionError(result.error);
                      });
                    }}
                    onMouseLeave={() => {
                      if (componentSnapshot.capabilities.highlight) {
                        void api.interactWithReactComponent('hideHighlight');
                      }
                    }}
                    onClick={() => setSelectedComponentId(node.id)}
                    role="treeitem"
                    style={{ paddingLeft: `${12 + node.depth * 14}px` }}
                  >
                    <span className={`component-kind ${node.kind}`}>◆</span>
                    <strong>{node.name}</strong>
                    {node.key && <small>key={node.key}</small>}
                    {node.kind !== 'function' && <em>{node.kind}</em>}
                    {node.changed.length > 0 && (
                      <i title={`Changed: ${node.changed.join(', ')}`}>●</i>
                    )}
                  </button>
                ))}
              </div>
            </aside>
            <ComponentDetails
              node={selectedComponent}
              owner={componentSnapshot.nodes.find((node) => node.id === selectedComponent?.ownerId)}
              onSelectOwner={setSelectedComponentId}
              onOpenSource={(node) => {
                if (!node.source) return;
                const direct = state.sources.find((source) => source.id === node.source?.sourceId);
                const suffix = node.source.sourceId.replace(/^.*[\\/]/, '');
                const matching =
                  direct ??
                  state.sources.find(
                    (source) =>
                      source.url.endsWith(node.source!.sourceId) || source.name === suffix,
                  );
                setSourceId(matching?.id ?? node.source.sourceId);
                setRequestedSourceLine(node.source.line);
                setWorkbench('sources');
              }}
            />
          </div>
        )}
        {workbench === 'profiler' && (
          <ComponentProfiler
            nodes={componentSnapshot.nodes}
            onRefresh={() => void refreshComponents()}
            onSelect={(id) => {
              setSelectedComponentId(id);
              setWorkbench('components');
            }}
          />
        )}
        {workbench === 'sources' && (
          <section className={`debugger-bottom-drawer ${bottomOpen ? 'open' : ''}`}>
            <header>
              <nav>
                {(['console', 'watch', 'breakpoints'] as const).map((tab) => (
                  <button
                    className={bottomTab === tab ? 'active' : ''}
                    key={tab}
                    onClick={() => {
                      setBottomTab(tab);
                      setBottomOpen(true);
                    }}
                  >
                    {tab === 'console'
                      ? 'Debugger Console'
                      : tab === 'watch'
                        ? `Watch (${state.watches.length})`
                        : `Breakpoints (${state.breakpoints.length})`}
                  </button>
                ))}
              </nav>
              <div>
                {bottomTab === 'console' && (
                  <button
                    onClick={() => {
                      for (const entry of consoleEntries) {
                        if (entry.result?.objectId)
                          void api.releaseDebuggerObject(entry.result.objectId);
                      }
                      setConsoleEntries([]);
                    }}
                  >
                    Clear
                  </button>
                )}
                <button
                  aria-label={bottomOpen ? 'Close bottom drawer' : 'Open bottom drawer'}
                  onClick={() => setBottomOpen((current) => !current)}
                >
                  {bottomOpen ? '⌄' : '⌃'}
                </button>
              </div>
            </header>
            {bottomOpen && bottomTab === 'console' && (
              <div className="debugger-console">
                <div className="debugger-console-output" aria-live="polite">
                  {consoleEntries.length === 0 && (
                    <p>
                      Evaluate JavaScript in the selected frame. Hover source variables for a quick
                      preview.
                    </p>
                  )}
                  {consoleEntries.map((entry) => (
                    <div className="debugger-console-entry" key={entry.id}>
                      <div>
                        <span>›</span>
                        <code>{entry.expression}</code>
                      </div>
                      <div className={entry.error ? 'error' : ''}>
                        <span>←</span>
                        {entry.error ? (
                          <pre>{entry.error}</pre>
                        ) : entry.result ? (
                          <RemoteValueView value={entry.result} />
                        ) : (
                          <em>Evaluating…</em>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {showCompletions && consoleCompletions.length > 0 && (
                  <div className="debugger-console-completions">
                    {consoleCompletions.map((name) => (
                      <button
                        key={name}
                        onClick={() => {
                          setEvaluation((current) => current.replace(/[A-Za-z_$][\w$]*$/, name));
                          setShowCompletions(false);
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="debugger-console-prompt">
                  <span>›</span>
                  <textarea
                    aria-label="Debugger console expression"
                    onChange={(event) => setEvaluation(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.code === 'Space') {
                        event.preventDefault();
                        setShowCompletions(true);
                      } else if (event.key === 'Tab' && showCompletions && consoleCompletions[0]) {
                        event.preventDefault();
                        setEvaluation((current) =>
                          current.replace(/[A-Za-z_$][\w$]*$/, consoleCompletions[0]!),
                        );
                        setShowCompletions(false);
                      } else if (event.key === 'Escape') {
                        setShowCompletions(false);
                      } else if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        setShowCompletions(false);
                        void executeConsole();
                      } else if (event.key === 'ArrowUp' && !evaluation.includes('\n')) {
                        event.preventDefault();
                        const next = Math.min(consoleHistory.length - 1, historyIndex + 1);
                        setHistoryIndex(next);
                        setEvaluation(consoleHistory[next] ?? '');
                      } else if (event.key === 'ArrowDown' && !evaluation.includes('\n')) {
                        event.preventDefault();
                        const next = Math.max(-1, historyIndex - 1);
                        setHistoryIndex(next);
                        setEvaluation(next < 0 ? '' : (consoleHistory[next] ?? ''));
                      }
                    }}
                    placeholder={
                      paused ? 'Evaluate in selected call frame…' : 'Evaluate in runtime…'
                    }
                    rows={1}
                    value={evaluation}
                  />
                  <button
                    disabled={!connected || !evaluation.trim()}
                    onClick={() => void executeConsole()}
                  >
                    Run
                  </button>
                </div>
              </div>
            )}
            {bottomOpen && bottomTab === 'watch' && (
              <WatchPane
                paused={paused}
                state={state}
                value={watchExpression}
                onChange={setWatchExpression}
                onAdd={(expression) => void run(() => api.addDebuggerWatch(expression))}
                onRemove={(id) => void run(() => api.removeDebuggerWatch(id))}
              />
            )}
            {bottomOpen && bottomTab === 'breakpoints' && (
              <BreakpointPane
                state={state}
                onOpen={setSourceId}
                onToggle={(id, enabled) =>
                  void run(() => api.setDebuggerBreakpointEnabled(id, enabled))
                }
              />
            )}
          </section>
        )}
      </main>
      {workbench === 'sources' && (
        <aside className="debugger-sidebar">
          <nav className="debugger-side-tabs" aria-label="Debugger details">
            {(['frames', 'variables', 'watch', 'breakpoints'] as const).map((tab) => (
              <button
                className={sideTab === tab ? 'active' : ''}
                key={tab}
                onClick={() => setSideTab(tab)}
                title={tab}
              >
                {tab === 'frames' ? 'Stack' : tab === 'variables' ? 'Variables' : tab}
              </button>
            ))}
          </nav>
          {sideTab === 'frames' && (
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
                      {state.sources.find((source) => source.id === frame.location.sourceId)
                        ?.name ?? frame.location.sourceId}
                      :{frame.location.line}
                    </small>
                  </button>
                ))}
                {!paused && <p>Pause execution to inspect frames.</p>}
              </div>
            </section>
          )}
          {sideTab === 'variables' && (
            <section className="debugger-flex-section">
              <header>
                <strong>Scopes</strong>
              </header>
              <input
                aria-label="Search variables"
                className="debugger-variable-search"
                onChange={(event) => setVariableSearch(event.target.value)}
                placeholder="Search variables…"
                type="search"
                value={variableSearch}
              />
              <div className="scope-list">
                {state.callFrames
                  .find((frame) => frame.id === state.selectedCallFrameId)
                  ?.scopes.map((scope, index) => (
                    <details
                      key={`${scope.type}-${index}`}
                      onToggle={(event) => {
                        if (event.currentTarget.open && scope.objectId)
                          void loadScope(scope.objectId);
                      }}
                    >
                      <summary>{scope.name || scope.type}</summary>
                      {scope.objectId &&
                        (scopeProperties[scope.objectId] ?? [])
                          .filter(
                            (property) =>
                              !variableSearch ||
                              property.name.toLowerCase().includes(variableSearch.toLowerCase()) ||
                              valueText(property.value)
                                .toLowerCase()
                                .includes(variableSearch.toLowerCase()),
                          )
                          .map((property) => (
                            <div className="debugger-property" key={property.name}>
                              <span>{property.name}</span>
                              <RemoteValueView compact value={property.value} />
                            </div>
                          ))}
                    </details>
                  ))}
              </div>
            </section>
          )}
          {sideTab === 'watch' && (
            <WatchPane
              paused={paused}
              state={state}
              value={watchExpression}
              onChange={setWatchExpression}
              onAdd={(expression) => void run(() => api.addDebuggerWatch(expression))}
              onRemove={(id) => void run(() => api.removeDebuggerWatch(id))}
            />
          )}
          {sideTab === 'frames' && (
            <section className="pause-exceptions">
              <label>
                Pause on exceptions
                <select
                  disabled={connected && !state.capabilities.pauseOnExceptions}
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
          )}
          {sideTab === 'breakpoints' && (
            <BreakpointPane
              state={state}
              onOpen={setSourceId}
              onToggle={(id, enabled) =>
                void run(() => api.setDebuggerBreakpointEnabled(id, enabled))
              }
            />
          )}
        </aside>
      )}
    </>
  );
}

function WatchPane({
  paused,
  state,
  value,
  onChange,
  onAdd,
  onRemove,
}: {
  paused: boolean;
  state: DebuggerState;
  value: string;
  onChange(value: string): void;
  onAdd(value: string): void;
  onRemove(id: string): void;
}) {
  return (
    <section className="debugger-pane debugger-flex-section">
      <header>
        <strong>Watch expressions</strong>
      </header>
      <form
        className="debugger-input"
        onSubmit={(event) => {
          event.preventDefault();
          if (!value.trim()) return;
          onAdd(value);
          onChange('');
        }}
      >
        <input
          disabled={!paused}
          placeholder="Add expression…"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </form>
      <div className="watch-list">
        {state.watches.map((watch) => (
          <div key={watch.id}>
            <span>{watch.expression}</span>
            {watch.error ? (
              <code className="debugger-value-error">{watch.error}</code>
            ) : watch.result ? (
              <RemoteValueView compact value={watch.result} />
            ) : (
              <code>Not paused</code>
            )}
            <button aria-label={`Remove ${watch.expression}`} onClick={() => onRemove(watch.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function BreakpointPane({
  state,
  onOpen,
  onToggle,
}: {
  state: DebuggerState;
  onOpen(sourceId: string): void;
  onToggle(id: string, enabled: boolean): void;
}) {
  return (
    <section className="debugger-pane debugger-flex-section">
      <header>
        <strong>Breakpoints</strong>
      </header>
      <div className="breakpoint-list">
        {state.breakpoints.map((breakpoint) => (
          <div key={breakpoint.id}>
            <input
              aria-label={`Enable breakpoint at line ${breakpoint.line}`}
              checked={breakpoint.enabled}
              type="checkbox"
              onChange={(event) => onToggle(breakpoint.id, event.target.checked)}
            />
            <button onClick={() => onOpen(breakpoint.sourceId)}>
              {state.sources.find((source) => source.id === breakpoint.sourceId)?.name ??
                breakpoint.sourceId}
              :{breakpoint.line}
              {breakpoint.condition ? ` · if ${breakpoint.condition}` : ''}
              {breakpoint.hitCondition ? ` · hit ${breakpoint.hitCondition}` : ''}
              {breakpoint.logMessage ? ` · log ${breakpoint.logMessage}` : ''}
            </button>
            <span className={breakpoint.verified ? 'verified' : 'pending'} title={breakpoint.error}>
              {breakpoint.verified ? '●' : '○'} {breakpoint.hitCount ?? 0}
            </span>
          </div>
        ))}
      </div>
      <small className="debugger-hint">
        Shift-click: condition · Cmd/Ctrl-click: hit count · Option/Alt-click: logpoint
      </small>
    </section>
  );
}

function ComponentDetails({
  node,
  owner,
  onOpenSource,
  onSelectOwner,
}: {
  node?: ReactComponentNode;
  owner?: ReactComponentNode;
  onOpenSource(node: ReactComponentNode): void;
  onSelectOwner(id: string): void;
}) {
  const [tab, setTab] = useState<'props' | 'state' | 'hooks' | 'style' | 'accessibility'>('props');
  if (!node) {
    return (
      <section className="component-details component-empty-state">
        <strong>Select a rendered React component</strong>
        <p>Inspect props, state, hooks, styles, accessibility, and render cost.</p>
      </section>
    );
  }
  const record =
    tab === 'props'
      ? node.props
      : tab === 'state'
        ? node.state
        : tab === 'style'
          ? (node.style ?? {})
          : tab === 'accessibility'
            ? Object.fromEntries(
                Object.entries(node.accessibility ?? {}).map(([key, value]) => [
                  key,
                  String(value),
                ]),
              )
            : undefined;
  return (
    <section className="component-details">
      <header>
        <div>
          <span className={`component-kind ${node.kind}`}>◆</span>
          <strong>{node.name}</strong>
          <small>{node.kind}</small>
        </div>
        <div>
          {node.renderDuration !== undefined && (
            <span>{node.renderDuration.toFixed(2)} ms render</span>
          )}
          {node.renderCount !== undefined && <span>{node.renderCount} observed renders</span>}
          <button disabled={!node.source} onClick={() => onOpenSource(node)}>
            Open source
          </button>
        </div>
      </header>
      <nav>
        {(['props', 'state', 'hooks', 'style', 'accessibility'] as const).map((name) => (
          <button className={tab === name ? 'active' : ''} key={name} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>
      <div className="component-value-table">
        {tab === 'hooks'
          ? node.hooks.map((hook) => (
              <div key={hook.index}>
                <strong>Hook {hook.index}</strong>
                <code>{hook.value}</code>
              </div>
            ))
          : Object.entries(record ?? {}).map(([name, value]) => (
              <div key={name}>
                <strong>{name}</strong>
                <code>{value}</code>
              </div>
            ))}
        {(tab === 'hooks' ? node.hooks.length === 0 : Object.keys(record ?? {}).length === 0) && (
          <p>No {tab} values were exposed by this component.</p>
        )}
      </div>
      <footer>
        {node.source ? (
          <span>
            {node.source.sourceId}:{node.source.line}:{node.source.column}
          </span>
        ) : (
          <span>Source location unavailable</span>
        )}
        {node.nativeTag !== undefined && <span>Native tag {node.nativeTag}</span>}
        {owner && (
          <button
            onClick={() => onSelectOwner(owner.id)}
            title="Select the component that rendered this one"
          >
            Rendered by {owner.name}
          </button>
        )}
      </footer>
    </section>
  );
}

function ComponentProfiler({
  nodes,
  onRefresh,
  onSelect,
}: {
  nodes: ReactComponentNode[];
  onRefresh(): void;
  onSelect(id: string): void;
}) {
  const [recording, setRecording] = useState(false);
  const [samples, setSamples] = useState<
    Record<string, { id: string; name: string; total: number; maximum: number; samples: number }>
  >({});

  useEffect(() => {
    if (!recording) return;
    let active = true;
    let capturing = false;
    const capture = async () => {
      if (capturing) return;
      capturing = true;
      try {
        const snapshot = await window.pulseRN.getReactComponentSnapshot();
        if (!active) return;
        setSamples((current) => {
          const next = { ...current };
          for (const node of snapshot.nodes) {
            if (!node.renderDuration || node.renderDuration <= 0) continue;
            const previous = next[node.id] ?? {
              id: node.id,
              name: node.name,
              total: 0,
              maximum: 0,
              samples: 0,
            };
            next[node.id] = {
              ...previous,
              total: previous.total + node.renderDuration,
              maximum: Math.max(previous.maximum, node.renderDuration),
              samples: previous.samples + 1,
            };
          }
          return next;
        });
      } catch {
        // A target reload is surfaced by the debugger connection state.
      } finally {
        capturing = false;
      }
    };
    void capture();
    const timer = window.setInterval(() => void capture(), 750);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [recording]);

  const ranked =
    Object.keys(samples).length > 0
      ? Object.values(samples)
          .sort((left, right) => right.total - left.total)
          .slice(0, 100)
      : [...nodes]
          .filter((node) => node.renderDuration !== undefined && node.renderDuration > 0)
          .map((node) => ({
            id: node.id,
            name: node.name,
            total: node.renderDuration ?? 0,
            maximum: node.renderDuration ?? 0,
            samples: 1,
          }))
          .sort((left, right) => right.total - left.total)
          .slice(0, 100);
  const maximum = Math.max(1, ...ranked.map((node) => node.total));
  return (
    <section className="component-profiler">
      <header>
        <div>
          <h2>React render costs</h2>
          <p>Current Fiber timings from the attached development runtime.</p>
        </div>
        <div className="component-profiler-actions">
          <button
            onClick={() => {
              if (!recording) setSamples({});
              setRecording((current) => !current);
            }}
          >
            {recording ? 'Stop recording' : 'Start recording'}
          </button>
          <button onClick={onRefresh}>Capture snapshot</button>
        </div>
      </header>
      {ranked.length === 0 ? (
        <div className="component-empty-state">
          <strong>No component timing data yet</strong>
          <p>Interact with the app, then capture another snapshot.</p>
        </div>
      ) : (
        <div className="component-profile-list">
          {ranked.map((node) => (
            <button key={node.id} onClick={() => onSelect(node.id)}>
              <span>{node.name}</span>
              <span className="profile-bar">
                <i style={{ width: `${(node.total / maximum) * 100}%` }} />
              </span>
              <code title={`Peak ${node.maximum.toFixed(2)} ms · ${node.samples} samples`}>
                {node.total.toFixed(2)} ms
              </code>
            </button>
          ))}
        </div>
      )}
      <footer>
        These are JavaScript/React Fiber estimates, not native CPU or UI-thread measurements.
      </footer>
    </section>
  );
}
