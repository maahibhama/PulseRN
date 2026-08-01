import { useEffect, useMemo, useState } from 'react';
import type { ConnectedDevice } from '../../main/session-manager.js';

interface StoragePanelProps {
  devices: ConnectedDevice[];
}

interface Provider {
  id: string;
  name: string;
  capabilities: {
    paginatedKeys: boolean;
    lazyValues: boolean;
    mutations: boolean;
    typedValues: boolean;
    snapshots: boolean;
  };
}

interface KeyEntry {
  key: string;
  valueSize?: number;
  valueType: 'string' | 'number' | 'boolean' | 'json' | 'binary' | 'unknown';
  sensitive: boolean;
}

export function StoragePanel({ devices }: StoragePanelProps) {
  const [connectionId, setConnectionId] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState('');
  const [keys, setKeys] = useState<string[]>([]);
  const [keyEntries, setKeyEntries] = useState<KeyEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [totalKeys, setTotalKeys] = useState(0);
  const [selectedKey, setSelectedKey] = useState('');
  const [value, setValue] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [valueType, setValueType] = useState<KeyEntry['valueType']>('unknown');
  const [valueSize, setValueSize] = useState(0);
  const [sensitive, setSensitive] = useState(false);
  const [undo, setUndo] = useState<{ operation: 'set' | 'delete'; key: string; value: string }>();
  const [snapshots, setSnapshots] = useState<{ key: string; value: string; at: number }[]>([]);
  const [audit, setAudit] = useState<string[]>([]);
  const api = window.pulseRN;

  useEffect(() => {
    if (!devices.some((device) => device.connectionId === connectionId)) {
      setConnectionId(devices[0]?.connectionId ?? '');
    }
  }, [connectionId, devices]);

  useEffect(() => {
    if (!connectionId) {
      setProviders([]);
      setProviderId('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void api
      .requestStorage({ connectionId, providerId: 'all', operation: 'providers' })
      .then((result) => {
        if (cancelled) return;
        if (!result.success) throw new Error(result.error ?? 'Could not list storage providers.');
        const nextProviders = result.providers ?? [];
        setProviders(nextProviders);
        setProviderId((current) =>
          nextProviders.some((provider) => provider.id === current)
            ? current
            : (nextProviders[0]?.id ?? ''),
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Storage request failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, connectionId]);

  const refreshKeys = async (cursor?: string) => {
    if (!connectionId || !providerId) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.requestStorage({
        connectionId,
        providerId,
        operation: 'list',
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (!result.success) throw new Error(result.error ?? 'Could not list storage keys.');
      setKeys((current) => (cursor ? [...current, ...(result.keys ?? [])] : (result.keys ?? [])));
      setKeyEntries((current) =>
        cursor ? [...current, ...(result.keyEntries ?? [])] : (result.keyEntries ?? []),
      );
      setNextCursor(result.nextCursor);
      setTotalKeys(result.totalKeys ?? result.keys?.length ?? 0);
      if (!cursor && selectedKey && !result.keys?.includes(selectedKey)) {
        setSelectedKey('');
        setValue('');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Storage request failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (providerId) void refreshKeys();
  }, [connectionId, providerId]);

  const selectKey = async (key: string) => {
    setSelectedKey(key);
    setLoading(true);
    setError('');
    try {
      const result = await api.requestStorage({
        connectionId,
        providerId,
        operation: 'get',
        key,
      });
      if (!result.success) throw new Error(result.error ?? 'Could not read storage value.');
      setValue(result.value ?? '');
      setValueType(result.valueType ?? 'unknown');
      setValueSize(result.valueSize ?? 0);
      setSensitive(result.sensitive ?? false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Storage request failed.');
    } finally {
      setLoading(false);
    }
  };

  const updateValue = async () => {
    if (!selectedKey) return;
    if (!window.confirm(`Update "${selectedKey}" in ${providerId}?`)) return;
    const original = value;
    setLoading(true);
    try {
      const result = await api.requestStorage({
        connectionId,
        providerId,
        operation: 'set',
        key: selectedKey,
        value,
      });
      if (!result.success) throw new Error(result.error ?? 'Could not update storage value.');
      setUndo({ operation: 'set', key: selectedKey, value: original });
      setAudit((current) => [`Updated ${selectedKey} at ${new Date().toISOString()}`, ...current]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Storage update failed.');
    } finally {
      setLoading(false);
    }
  };

  const deleteValue = async () => {
    if (!selectedKey) return;
    if (!window.confirm(`Delete "${selectedKey}" from ${providerId}?`)) return;
    const deletedKey = selectedKey;
    const original = value;
    setLoading(true);
    try {
      const result = await api.requestStorage({
        connectionId,
        providerId,
        operation: 'delete',
        key: selectedKey,
      });
      if (!result.success) throw new Error(result.error ?? 'Could not delete storage value.');
      setUndo({ operation: 'delete', key: deletedKey, value: original });
      setAudit((current) => [`Deleted ${deletedKey} at ${new Date().toISOString()}`, ...current]);
      setSelectedKey('');
      setValue('');
      await refreshKeys();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Storage delete failed.');
    } finally {
      setLoading(false);
    }
  };
  const undoMutation = async () => {
    if (!undo || !window.confirm(`Restore the local backup for "${undo.key}"?`)) return;
    const result = await api.requestStorage({
      connectionId,
      providerId,
      operation: 'set',
      key: undo.key,
      value: undo.value,
    });
    if (!result.success) {
      setError(result.error ?? 'Could not restore the local backup.');
      return;
    }
    setAudit((current) => [`Restored ${undo.key} at ${new Date().toISOString()}`, ...current]);
    setUndo(undefined);
    await refreshKeys();
  };

  const filteredKeys = useMemo(
    () => keys.filter((key) => key.toLowerCase().includes(search.trim().toLowerCase())),
    [keys, search],
  );
  const containsRedaction = value.includes('[REDACTED]');

  return (
    <main className="timeline storage-panel">
      <div className="panel-header">
        <div>
          <strong>Storage</strong>
          <span>
            {keys.length} of {totalKeys} keys
          </span>
        </div>
        <div className="actions">
          <button disabled={!providerId || loading} onClick={() => void refreshKeys()}>
            Refresh
          </button>
          <button disabled={!undo || loading} onClick={() => void undoMutation()}>
            Undo last mutation
          </button>
        </div>
      </div>
      <div className="storage-toolbar">
        <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
          {devices.length === 0 && <option value="">No connected device</option>}
          {devices.map((device) => (
            <option key={device.connectionId} value={device.connectionId}>
              {device.device.name}
            </option>
          ))}
        </select>
        <select
          disabled={providers.length === 0}
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
        >
          {providers.length === 0 && <option value="">No storage provider</option>}
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name} {provider.capabilities.typedValues ? '· typed' : '· strings'}
            </option>
          ))}
        </select>
        <input
          aria-label="Search storage keys"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search keys…"
          type="search"
          value={search}
        />
      </div>
      {error && <div className="storage-error">{error}</div>}
      <div className="storage-workspace">
        <div className="storage-keys">
          {filteredKeys.length === 0 ? (
            <div className="storage-empty">
              {loading
                ? 'Loading…'
                : providerId
                  ? 'No matching keys'
                  : 'Register a storage provider'}
            </div>
          ) : (
            filteredKeys.map((key) => (
              <button
                className={selectedKey === key ? 'selected' : ''}
                key={key}
                onClick={() => void selectKey(key)}
              >
                <span>{key}</span>
                <small>
                  {keyEntries.find((entry) => entry.key === key)?.valueType ?? 'unknown'}
                  {keyEntries.find((entry) => entry.key === key)?.valueSize !== undefined
                    ? ` · ${keyEntries.find((entry) => entry.key === key)!.valueSize} bytes`
                    : ''}
                </small>
              </button>
            ))
          )}
        </div>
        <div className="storage-editor">
          {selectedKey ? (
            <>
              <div className="storage-editor-header">
                <strong>
                  {selectedKey} · {valueType} · {valueSize.toLocaleString()} bytes
                </strong>
                <div>
                  <button
                    disabled={loading || containsRedaction || sensitive}
                    onClick={() => void updateValue()}
                  >
                    Update
                  </button>
                  <button
                    className="danger"
                    disabled={loading || sensitive}
                    onClick={() => void deleteValue()}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {containsRedaction && (
                <p className="storage-warning">
                  This JSON contains redacted fields. Updating is disabled to avoid overwriting
                  secrets with redaction markers.
                </p>
              )}
              <button
                disabled={sensitive || containsRedaction}
                onClick={() =>
                  setSnapshots((current) => [
                    { key: selectedKey, value, at: Date.now() },
                    ...current,
                  ])
                }
              >
                Create read-only snapshot
              </button>
              <textarea
                aria-label={`Value for ${selectedKey}`}
                onChange={(event) => setValue(event.target.value)}
                spellCheck={false}
                value={value}
              />
            </>
          ) : (
            <div className="storage-empty">Select a key to inspect its value.</div>
          )}
        </div>
      </div>
      {nextCursor && (
        <button className="storage-load-more" onClick={() => void refreshKeys(nextCursor)}>
          Load next 100 keys
        </button>
      )}
      {(snapshots.length > 0 || audit.length > 0) && (
        <div className="storage-local-records">
          <strong>Local snapshots and audit</strong>
          {snapshots.map((snapshot) => (
            <details key={`${snapshot.key}:${snapshot.at}`}>
              <summary>
                Snapshot · {snapshot.key} · {new Date(snapshot.at).toLocaleTimeString()}
              </summary>
              <pre>{snapshot.value}</pre>
            </details>
          ))}
          {audit.map((entry) => (
            <span key={entry}>{entry}</span>
          ))}
        </div>
      )}
    </main>
  );
}
