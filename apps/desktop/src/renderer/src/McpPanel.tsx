import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, McpInfo } from '../../preload/api.js';

type McpClient = 'Claude' | 'Codex' | 'Cursor' | 'Other';

interface ClientGuide {
  label: string;
  file: string;
  steps: string[];
}

const guides: Record<McpClient, ClientGuide> = {
  Claude: {
    label: 'Claude',
    file: 'Claude Code .mcp.json or Claude Desktop configuration',
    steps: [
      'Copy the generated configuration below.',
      'Add it to Claude Code or Claude Desktop.',
      'Restart Claude, approve the local server if prompted, then open its MCP tools.',
    ],
  },
  Codex: {
    label: 'Codex',
    file: '~/.codex/config.toml',
    steps: [
      'Copy the generated TOML configuration below.',
      'Add the TOML configuration to your Codex user or trusted-project config.',
      'Restart Codex and ask it to list the available PulseRN sessions.',
    ],
  },
  Cursor: {
    label: 'Cursor',
    file: '~/.cursor/mcp.json or <project>/.cursor/mcp.json',
    steps: [
      'Copy the generated JSON configuration below.',
      'Add the JSON configuration globally or inside the current project.',
      'Restart Cursor and check Settings → MCP for the pulsern server.',
    ],
  },
  Other: {
    label: 'Other tools',
    file: 'Your client’s local stdio MCP configuration',
    steps: [
      'Choose the client’s local or stdio MCP server option.',
      'Copy the generated command, arguments, and environment configuration.',
      'Restart the client and verify that pulsern_list_sessions is available.',
    ],
  },
};

function jsonConfig(info: McpInfo, client: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        pulsern: {
          command: info.command,
          args: info.args,
          env: {
            ...info.env,
            PULSERN_MCP_CLIENT: client,
          },
        },
      },
    },
    null,
    2,
  );
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexConfig(info: McpInfo): string {
  const environment = {
    ...info.env,
    PULSERN_MCP_CLIENT: 'Codex',
  };
  return `[mcp_servers.pulsern]
command = ${tomlString(info.command)}
args = [${info.args.map(tomlString).join(', ')}]

[mcp_servers.pulsern.env]
${Object.entries(environment)
  .map(([key, value]) => `${key} = ${tomlString(value)}`)
  .join('\n')}`;
}

export function McpPanel({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange(patch: Partial<AppSettings>): Promise<void>;
}) {
  const [client, setClient] = useState<McpClient>('Claude');
  const [copied, setCopied] = useState<'config' | 'test'>();
  const [error, setError] = useState('');
  const [info, setInfo] = useState<McpInfo>();
  const guide = guides[client];
  const config = useMemo(() => {
    if (!info) return 'Loading the bundled MCP configuration…';
    return client === 'Codex' ? codexConfig(info) : jsonConfig(info, client);
  }, [client, info]);
  const testPrompt = useMemo(
    () =>
      'Use PulseRN to list the latest debugging sessions, inspect the newest errors, and correlate them with network, Redux, and navigation events.',
    [],
  );

  useEffect(() => {
    void window.pulseRN
      .getMcpInfo()
      .then(setInfo)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Unable to load MCP status.'),
      );
    return window.pulseRN.onMcpInfo(setInfo);
  }, []);

  const copy = async (kind: 'config' | 'test', value: string) => {
    setError('');
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(undefined), 1_500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to copy to the clipboard.');
    }
  };

  const toggle = async () => {
    setError('');
    try {
      await onChange({ mcpEnabled: !settings.mcpEnabled });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update MCP access.');
    }
  };

  return (
    <main className="timeline mcp-panel">
      <div className="panel-header">
        <div>
          <strong>MCP</strong>
          <span>Connect PulseRN to your AI debugging tools</span>
        </div>
        <span
          className={`mcp-status ${info?.clients.length ? 'connected' : settings.mcpEnabled ? 'enabled' : ''}`}
        >
          <i />
          {info?.clients.length
            ? `${info.clients.length} AI client${info.clients.length === 1 ? '' : 's'} connected`
            : settings.mcpEnabled
              ? 'Waiting for an AI client'
              : 'Disabled'}
        </span>
      </div>

      <div className="mcp-scroll">
        <section className="mcp-hero">
          <div className="mcp-mark">M</div>
          <div>
            <h1>Debug React Native with any MCP client</h1>
            <p>
              Give trusted AI tools controlled access to PulseRN sessions, events, Hermes, React
              components, and connected app storage.
            </p>
          </div>
          <button className={settings.mcpEnabled ? 'danger-button' : 'primary'} onClick={toggle}>
            {settings.mcpEnabled ? 'Disable MCP' : 'Enable MCP'}
          </button>
        </section>

        <section className="mcp-warning">
          <strong>Full debugger control</strong>
          <span>
            Enabled clients can execute JavaScript and change application storage. PulseRN accepts
            only authenticated local connections and records sanitized actions.
          </span>
        </section>

        <section className="mcp-access-card">
          <div>
            <strong>AI access mode</strong>
            <small>
              Choose the maximum level of control available to every connected MCP client.
            </small>
          </div>
          <select
            aria-label="MCP access mode"
            value={settings.mcpAccessMode}
            onChange={(event) =>
              void onChange({
                mcpAccessMode: event.target.value as AppSettings['mcpAccessMode'],
              })
            }
          >
            <option value="read-only">Read-only diagnostics</option>
            <option value="debugger">Debugger control</option>
            <option value="full">Full control</option>
          </select>
          <small>
            {settings.mcpAccessMode === 'read-only'
              ? 'Can inspect events, diagnoses, sources, snapshots, debugger state, and storage values.'
              : settings.mcpAccessMode === 'debugger'
                ? 'Also allows connecting, pausing, stepping, and managing breakpoints.'
                : 'Also allows JavaScript evaluation, React interaction, and storage mutations.'}
          </small>
        </section>

        {settings.mcpEnabled && (
          <section className="mcp-connection-card">
            <header>
              <div>
                <strong>Connection check</strong>
                <small>
                  {info?.clients.length
                    ? 'PulseRN has received authenticated MCP requests.'
                    : 'Configure and restart your AI client to complete the connection.'}
                </small>
              </div>
              <span className={info?.clients.length ? 'verified' : 'waiting'}>
                {info?.clients.length ? 'Connected successfully' : 'Waiting for connection'}
              </span>
            </header>
            {info?.clients.map((connectedClient) => (
              <div className="mcp-client-connection" key={connectedClient.name}>
                <span>
                  <i />
                  <strong>{connectedClient.name}</strong>
                </span>
                <small>
                  {connectedClient.requestCount} request
                  {connectedClient.requestCount === 1 ? '' : 's'} · last seen{' '}
                  {new Date(connectedClient.lastSeenAt).toLocaleTimeString()}
                </small>
              </div>
            ))}
          </section>
        )}

        <section className="mcp-guide">
          <div className="mcp-client-tabs" role="tablist" aria-label="MCP client">
            {(Object.keys(guides) as McpClient[]).map((name) => (
              <button
                aria-selected={client === name}
                className={client === name ? 'active' : ''}
                key={name}
                onClick={() => setClient(name)}
                role="tab"
              >
                {guides[name].label}
              </button>
            ))}
          </div>

          <div className="mcp-config-card">
            <header>
              <div>
                <strong>{guide.label} configuration</strong>
                <small>{guide.file}</small>
              </div>
              <button disabled={!info} onClick={() => void copy('config', config)}>
                {copied === 'config' ? 'Copied' : 'Copy config'}
              </button>
            </header>
            <pre>
              <code>{config}</code>
            </pre>
          </div>

          <div className="mcp-instructions">
            <div>
              <strong>Setup</strong>
              <ol>
                {guide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
            <div>
              <strong>No additional installation</strong>
              <p>The MCP server is bundled inside the installed PulseRN application.</p>
              <small>
                Keep PulseRN open while using AI debugging. The copied configuration already
                contains the correct application and server paths for this installation.
              </small>
            </div>
          </div>
        </section>

        <section className="mcp-test-card">
          <div>
            <strong>Test your connection</strong>
            <p>After restarting your AI client, paste this prompt:</p>
            <blockquote>{testPrompt}</blockquote>
          </div>
          <button onClick={() => void copy('test', testPrompt)}>
            {copied === 'test' ? 'Copied' : 'Copy test prompt'}
          </button>
        </section>

        {error && <div className="mcp-error">{error}</div>}
      </div>
    </main>
  );
}
