import { useEffect, useMemo, useState } from 'react';
import type { ConnectedDevice } from '../../main/session-manager.js';
import type { StorageAuditRecord, StorageSnapshotRecord } from '../../preload/api.js';

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

const DEFAULT_CAPABILITIES: Provider['capabilities'] = {
  paginatedKeys: false,
  lazyValues: false,
  mutations: true,
  typedValues: false,
  snapshots: false,
};

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
  const [redacted, setRedacted] = useState(false);
  const [undo, setUndo] = useState<{ backupId: string; key: string }>();
  const [snapshots, setSnapshots] = useState<StorageSnapshotRecord[]>([]);
  const [audit, setAudit] = useState<StorageAuditRecord[]>([]);
  const [selectedForExport, setSelectedForExport] = useState<string[]>([]);
  const api = window.pulseRN;
  const activeProvider = providers.find((provider) => provider.id === providerId);

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
        const nextProviders = (result.providers ?? []).map((provider) => ({
          ...provider,
          capabilities: provider.capabilities ?? DEFAULT_CAPABILITIES,
        }));
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

  const refreshLocalRecords = async () => {
    const [nextAudit, nextSnapshots] = await Promise.all([
      api.listStorageAudit(),
      api.listStorageSnapshots(providerId || undefined),
    ]);
    setAudit(nextAudit);
    setSnapshots(nextSnapshots);
  };

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
    if (providerId) {
      setSelectedForExport([]);
      setUndo(undefined);
      void refreshKeys();
      void refreshLocalRecords();
    }
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
      setRedacted(result.redacted ?? false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Storage request failed.');
    } finally {
      setLoading(false);
    }
  };

  const updateValue = async () => {
    if (!selectedKey) return;
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
      if (result.backupId) setUndo({ backupId: result.backupId, key: selectedKey });
      await refreshLocalRecords();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Storage update failed.');
    } finally {
      setLoading(false);
    }
  };

  const deleteValue = async () => {
    if (!selectedKey) return;
    const deletedKey = selectedKey;
    setLoading(true);
    try {
      const result = await api.requestStorage({
        connectionId,
        providerId,
        operation: 'delete',
        key: selectedKey,
      });
      if (!result.success) throw new Error(result.error ?? 'Could not delete storage value.');
      if (result.backupId) setUndo({ backupId: result.backupId, key: deletedKey });
      setSelectedKey('');
      setValue('');
      await refreshKeys();
      await refreshLocalRecords();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Storage delete failed.');
    } finally {
      setLoading(false);
    }
  };
  const undoMutation = async () => {
    if (!undo) return;
    const result = await api.requestStorage({
      connectionId,
      providerId,
      operation: 'restore',
      key: undo.key,
      backupId: undo.backupId,
    });
    if (!result.success) {
      setError(result.error ?? 'Could not restore the local backup.');
      return;
    }
    setUndo(undefined);
    await refreshKeys();
    await refreshLocalRecords();
  };

  const createSnapshot = async () => {
    if (!selectedKey) return;
    setLoading(true);
    setError('');
    try {
      await api.createStorageSnapshot({ connectionId, providerId, key: selectedKey });
      await refreshLocalRecords();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the snapshot.');
    } finally {
      setLoading(false);
    }
  };

  const exportSelected = async () => {
    if (selectedForExport.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.exportStorageValues(
        selectedForExport.map((key) => ({ connectionId, providerId, key })),
      );
      if (!result.canceled && result.excluded > 0) {
        setError(`${result.excluded} sensitive, redacted, binary, or unavailable values excluded.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not export storage values.');
    } finally {
      setLoading(false);
    }
  };

  const filteredKeys = useMemo(
    () => keys.filter((key) => key.toLowerCase().includes(search.trim().toLowerCase())),
    [keys, search],
  );
  const containsRedaction = redacted || value.includes('[REDACTED]');
  const editorValidation = useMemo(() => {
    if (valueType === 'binary') return 'Binary values are read-only.';
    if (valueType === 'json') {
      try {
        JSON.parse(value);
      } catch {
        return 'Enter valid JSON before updating.';
      }
    }
    if (valueType === 'number' && !Number.isFinite(Number(value))) {
      return 'Enter a finite number.';
    }
    if (valueType === 'boolean' && value !== 'true' && value !== 'false') {
      return 'Boolean values must be true or false.';
    }
    return '';
  }, [value, valueType]);

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
          <button
            disabled={selectedForExport.length === 0 || loading}
            onClick={() => void exportSelected()}
          >
            Export selected ({selectedForExport.length})
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
      {activeProvider && (
        <div className="storage-capabilities" aria-label="Storage provider capabilities">
          <span>
            {activeProvider.capabilities.paginatedKeys ? 'Paginated keys' : 'Full key list'}
          </span>
          <span>{activeProvider.capabilities.lazyValues ? 'Lazy values' : 'Eager values'}</span>
          <span>{activeProvider.capabilities.typedValues ? 'Typed editor' : 'String editor'}</span>
          <span>{activeProvider.capabilities.mutations ? 'Mutations' : 'Read only'}</span>
          <span>{activeProvider.capabilities.snapshots ? 'Snapshots' : 'No snapshots'}</span>
        </div>
      )}
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
              <div className="storage-key-row" key={key}>
                <input
                  aria-label={`Select ${key} for export`}
                  checked={selectedForExport.includes(key)}
                  onChange={(event) =>
                    setSelectedForExport((current) =>
                      event.target.checked
                        ? [...new Set([...current, key])]
                        : current.filter((selected) => selected !== key),
                    )
                  }
                  type="checkbox"
                />
                <button
                  className={selectedKey === key ? 'selected' : ''}
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
              </div>
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
                    disabled={
                      loading ||
                      containsRedaction ||
                      sensitive ||
                      Boolean(editorValidation) ||
                      !activeProvider?.capabilities.mutations
                    }
                    onClick={() => void updateValue()}
                  >
                    Update
                  </button>
                  <button
                    className="danger"
                    disabled={loading || sensitive || !activeProvider?.capabilities.mutations}
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
              {editorValidation && <p className="storage-warning">{editorValidation}</p>}
              <button
                disabled={
                  sensitive ||
                  containsRedaction ||
                  valueType === 'binary' ||
                  !activeProvider?.capabilities.snapshots
                }
                onClick={() => void createSnapshot()}
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
            <details key={snapshot.id}>
              <summary>
                Snapshot · {snapshot.key} · {snapshot.valueType} ·{' '}
                {new Date(snapshot.createdAt).toLocaleTimeString()}
              </summary>
              <pre>{snapshot.value}</pre>
              <small>
                {snapshots.find(
                  (candidate) =>
                    candidate.key === snapshot.key &&
                    candidate.providerId === snapshot.providerId &&
                    candidate.createdAt < snapshot.createdAt,
                )?.value === snapshot.value
                  ? 'Unchanged from previous snapshot'
                  : 'Changed from previous snapshot or first snapshot'}
              </small>
              <button
                onClick={() => {
                  void api.deleteStorageSnapshot(snapshot.id).then(() => refreshLocalRecords());
                }}
              >
                Delete snapshot
              </button>
            </details>
          ))}
          {audit.map((entry) => (
            <span key={entry.id}>
              {entry.success ? '✓' : '×'} {entry.operation} · {entry.providerId} · {entry.key} ·{' '}
              {new Date(entry.createdAt).toLocaleTimeString()}
              {entry.error ? ` · ${entry.error}` : ''}
            </span>
          ))}
        </div>
      )}
    </main>
  );
}
