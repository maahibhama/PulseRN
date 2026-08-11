import { useEffect, useMemo, useState } from 'react';
import type { ConnectedDevice, RemoteNotificationResult } from '../../preload/api.js';
import type { NotificationCapabilities, NotificationInput } from '@pulse-rn/protocol';

type Mode = 'local' | 'remote';
export function PushLabPanel({ devices }: { devices: ConnectedDevice[] }) {
  const supported = devices.filter((device) =>
    device.capabilities?.includes('notification-testing'),
  );
  const [connectionId, setConnectionId] = useState(supported[0]?.connectionId ?? '');
  const device = devices.find((item) => item.connectionId === connectionId);
  const [mode, setMode] = useState<Mode>('local');
  const [rich, setRich] = useState(false);
  const [title, setTitle] = useState('PulseRN test');
  const [body, setBody] = useState('If you can read this, notifications are working.');
  const [mediaUrl, setMediaUrl] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [sound, setSound] = useState('default');
  const [badge, setBadge] = useState('');
  const [data, setData] = useState('{}');
  const [capabilities, setCapabilities] = useState<NotificationCapabilities>();
  const [tokenOverride, setTokenOverride] = useState('');
  const [rawPayload, setRawPayload] = useState('');
  const [apns, setApns] = useState<{
    key: string;
    keyId: string;
    teamId: string;
    topic: string;
    environment: 'sandbox' | 'production';
  }>({ key: '', keyId: '', teamId: '', topic: '', environment: 'sandbox' });
  const [fcmJson, setFcmJson] = useState('');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [attempts, setAttempts] = useState<{ at: number; mode: Mode; result: string }[]>([]);

  const parsedData = useMemo(() => {
    try {
      return JSON.parse(data || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [data]);
  const notification = useMemo<NotificationInput>(
    () => ({
      title,
      body,
      ...(rich && mediaUrl ? { mediaUrl } : {}),
      ...(deepLink ? { deepLink } : {}),
      ...(sound ? { sound } : {}),
      ...(badge ? { badge: Number(badge) } : {}),
      data: parsedData as never,
    }),
    [title, body, rich, mediaUrl, deepLink, sound, badge, parsedData],
  );
  const generated = useMemo(
    () =>
      device?.device.platform === 'ios'
        ? {
            aps: {
              alert: { title, body },
              sound: sound || undefined,
              badge: badge ? Number(badge) : undefined,
              ...(rich ? { 'mutable-content': 1 } : {}),
            },
            ...(rich && mediaUrl
              ? {
                  mediaUrl,
                  notifee_options: {
                    ios: { attachments: [{ url: mediaUrl }] },
                  },
                }
              : {}),
            ...(deepLink ? { deepLink } : {}),
            data: parsedData,
          }
        : {
            notification: { title, body, ...(rich && mediaUrl ? { image: mediaUrl } : {}) },
            android: { notification: { sound: sound || undefined } },
            ...(deepLink ? { data: { deepLink, ...parsedData } } : { data: parsedData }),
          },
    [device?.device.platform, title, body, sound, badge, rich, mediaUrl, deepLink, parsedData],
  );

  const resetPayload = () => setRawPayload(JSON.stringify(generated, null, 2));
  useEffect(resetPayload, [generated]);
  useEffect(() => {
    if (!connectionId && supported[0]) setConnectionId(supported[0].connectionId);
  }, [connectionId, supported]);
  const refresh = async () => {
    if (!connectionId) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await window.pulseRN.requestNotification({
        connectionId,
        operation: 'capabilities',
      });
      if (!result.success) throw new Error(result.error?.message);
      setCapabilities(result.capabilities);
      setStatus('Device capabilities refreshed.');
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'Capability request failed.');
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!device) return;
    try {
      JSON.parse(data || '{}');
    } catch {
      setStatus('Custom data must be valid JSON.');
      return;
    }
    if (rich && !mediaUrl.startsWith('https://')) {
      setStatus('Rich media requires an HTTPS media URL.');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      let message: string;
      if (mode === 'local') {
        const result = await window.pulseRN.requestNotification({
          connectionId,
          operation: 'present',
          notification,
        });
        if (!result.success) throw new Error(result.error?.message);
        setCapabilities(result.capabilities);
        message = 'Local notification presented.';
      } else {
        const token = tokenOverride.trim() || capabilities?.pushToken;
        if (!token)
          throw new Error('A device token is required. Refresh capabilities or paste an override.');
        const payload = JSON.parse(rawPayload) as Record<string, unknown>;
        let result: RemoteNotificationResult;
        if (device.device.platform === 'ios')
          result = await window.pulseRN.sendRemoteNotification({
            provider: 'apns',
            token,
            payload,
            credentials: { provider: 'apns', ...apns },
          });
        else
          result = await window.pulseRN.sendRemoteNotification({
            provider: 'fcm',
            token,
            payload,
            credentials: {
              provider: 'fcm',
              serviceAccountJson: fcmJson,
              ...(projectId ? { projectId } : {}),
            },
          });
        if (!result.success)
          throw new Error(
            `${result.error?.code ?? result.status}: ${result.error?.message ?? 'Push rejected'}`,
          );
        message = `Remote push accepted in ${result.durationMs} ms${result.messageId ? ` · ${result.messageId}` : ''}.`;
      }
      setStatus(message);
      setAttempts((current) =>
        [{ at: Date.now(), mode, result: message }, ...current].slice(0, 20),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Push failed.';
      setStatus(message);
      setAttempts((current) =>
        [{ at: Date.now(), mode, result: message }, ...current].slice(0, 20),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="panel push-lab">
      <div className="panel-header">
        <div>
          <h2>Push Lab</h2>
          <p>Test plain and rich notifications on a connected development app.</p>
        </div>
      </div>
      <section className="push-grid">
        <div className="card push-form">
          <label>
            Device
            <select
              value={connectionId}
              onChange={(e) => {
                setConnectionId(e.target.value);
                setCapabilities(undefined);
              }}
            >
              <option value="">Select a compatible device</option>
              {supported.map((item) => (
                <option key={item.connectionId} value={item.connectionId}>
                  {item.device.name} · {item.device.platform}
                </option>
              ))}
            </select>
          </label>
          {devices.length > supported.length && (
            <p className="muted">
              Older SDK clients are hidden because they do not advertise notification testing.
            </p>
          )}
          <div className="segmented">
            <button className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>
              Local
            </button>
            <button className={mode === 'remote' ? 'active' : ''} onClick={() => setMode('remote')}>
              Remote APNs/FCM
            </button>
            <button onClick={refresh} disabled={!device || busy}>
              Refresh device
            </button>
          </div>
          {capabilities && (
            <p className="push-capabilities">
              Permission: {capabilities.permission} · Local:{' '}
              {capabilities.localNotifications ? 'yes' : 'no'} · Rich media:{' '}
              {capabilities.richMedia ? 'yes' : 'no'} · Token:{' '}
              {capabilities.pushToken ? 'reported' : 'missing'}
            </p>
          )}
          <div className="segmented">
            <button className={!rich ? 'active' : ''} onClick={() => setRich(false)}>
              Plain
            </button>
            <button className={rich ? 'active' : ''} onClick={() => setRich(true)}>
              Rich media
            </button>
          </div>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Body
            <textarea value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {rich && (
            <>
              <label>
                HTTPS media URL
                <input
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  placeholder="https://…/image.jpg"
                />
              </label>
              {device?.device.platform === 'ios' && (
                <p className="warning">
                  Remote rich media on iOS requires a notification service extension. The guided
                  payload includes Notifee attachment options.
                </p>
              )}
            </>
          )}
          <div className="push-row">
            <label>
              Deep link
              <input value={deepLink} onChange={(e) => setDeepLink(e.target.value)} />
            </label>
            <label>
              Sound
              <input value={sound} onChange={(e) => setSound(e.target.value)} />
            </label>
            <label>
              Badge
              <input
                type="number"
                min="0"
                value={badge}
                onChange={(e) => setBadge(e.target.value)}
              />
            </label>
          </div>
          <label>
            Custom data (JSON)
            <textarea className="code" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
          {mode === 'remote' && (
            <>
              <label>
                Token override
                <input
                  value={tokenOverride}
                  onChange={(e) => setTokenOverride(e.target.value)}
                  placeholder="Uses reported token when empty"
                />
              </label>
              {device?.device.platform === 'ios' ? (
                <div className="push-row">
                  <label>
                    Key ID
                    <input
                      value={apns.keyId}
                      onChange={(e) => setApns({ ...apns, keyId: e.target.value })}
                    />
                  </label>
                  <label>
                    Team ID
                    <input
                      value={apns.teamId}
                      onChange={(e) => setApns({ ...apns, teamId: e.target.value })}
                    />
                  </label>
                  <label>
                    Topic / bundle ID
                    <input
                      value={apns.topic}
                      onChange={(e) => setApns({ ...apns, topic: e.target.value })}
                    />
                  </label>
                  <label>
                    Environment
                    <select
                      value={apns.environment}
                      onChange={(e) =>
                        setApns({
                          ...apns,
                          environment: e.target.value as 'sandbox' | 'production',
                        })
                      }
                    >
                      <option value="sandbox">Sandbox</option>
                      <option value="production">Production</option>
                    </select>
                  </label>
                  <label>
                    APNs .p8 key
                    <textarea
                      className="code"
                      value={apns.key}
                      onChange={(e) => setApns({ ...apns, key: e.target.value })}
                    />
                  </label>
                </div>
              ) : (
                <>
                  <label>
                    FCM service account JSON
                    <textarea
                      className="code"
                      value={fcmJson}
                      onChange={(e) => setFcmJson(e.target.value)}
                    />
                  </label>
                  <label>
                    Project ID override
                    <input value={projectId} onChange={(e) => setProjectId(e.target.value)} />
                  </label>
                </>
              )}
            </>
          )}
          {mode === 'remote' && (
            <label>
              Provider payload <button onClick={resetPayload}>Reset generated JSON</button>
              <textarea
                className="code payload-editor"
                value={rawPayload}
                onChange={(e) => setRawPayload(e.target.value)}
              />
            </label>
          )}
          <button
            className="primary"
            disabled={!device || busy || !title}
            onClick={() => void send()}
          >
            {busy ? 'Sending…' : `Send ${mode} test`}
          </button>
          {status && <p role="status">{status}</p>}
        </div>
        <aside className="push-attempts" aria-label="Push notification attempts">
          <h3>Attempts</h3>
          {attempts.length === 0 ? (
            <p className="muted">No tests sent this session.</p>
          ) : (
            attempts.map((attempt) => (
              <div className="push-attempt" key={attempt.at}>
                <time>{new Date(attempt.at).toLocaleTimeString()}</time>
                <strong>{attempt.mode}</strong>
                <span>{attempt.result}</span>
              </div>
            ))
          )}
        </aside>
      </section>
    </main>
  );
}
