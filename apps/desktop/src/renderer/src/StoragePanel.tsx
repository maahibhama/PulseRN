import { useEffect, useMemo, useState } from 'react';
import type { ConnectedDevice } from '../../main/session-manager.js';

interface StoragePanelProps {
  devices: ConnectedDevice[];
}

interface Provider {
  id: string;
  name: string;
}

export function StoragePanel({ devices }: StoragePanelProps) {
  const [connectionId, setConnectionId] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState('');
  const [keys, setKeys] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [value, setValue] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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

  const refreshKeys = async () => {
    if (!connectionId || !providerId) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.requestStorage({ connectionId, providerId, operation: 'list' });
      if (!result.success) throw new Error(result.error ?? 'Could not list storage keys.');
      setKeys(result.keys ?? []);
      if (selectedKey && !result.keys?.includes(selectedKey)) {
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Storage update failed.');
    } finally {
      setLoading(false);
    }
  };

  const deleteValue = async () => {
    if (!selectedKey) return;
    setLoading(true);
    try {
      const result = await api.requestStorage({
        connectionId,
        providerId,
        operation: 'delete',
        key: selectedKey,
      });
      if (!result.success) throw new Error(result.error ?? 'Could not delete storage value.');
      setSelectedKey('');
      setValue('');
      await refreshKeys();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Storage delete failed.');
    } finally {
      setLoading(false);
    }
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
          <span>{keys.length} keys</span>
        </div>
        <div className="actions">
          <button disabled={!providerId || loading} onClick={() => void refreshKeys()}>
            Refresh
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
              {provider.name}
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
                {key}
              </button>
            ))
          )}
        </div>
        <div className="storage-editor">
          {selectedKey ? (
            <>
              <div className="storage-editor-header">
                <strong>{selectedKey}</strong>
                <div>
                  <button
                    disabled={loading || containsRedaction}
                    onClick={() => void updateValue()}
                  >
                    Update
                  </button>
                  <button className="danger" disabled={loading} onClick={() => void deleteValue()}>
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
    </main>
  );
}
