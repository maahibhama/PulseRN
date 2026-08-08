import type { DevToolEventEnvelope } from '@pulse-rn/protocol';
import type { ConnectedDevice } from './session-manager.js';

export function createDemoSession(now = Date.now()): {
  device: ConnectedDevice;
  events: DevToolEventEnvelope[];
} {
  const sessionId = `pulsern-demo-${now}`;
  const deviceId = 'pulsern-demo-device';
  const appId = 'dev.pulsern.demo';
  const correlationId = 'demo-checkout-failure';
  const base = { protocolVersion: '1.0.0', sessionId, deviceId, appId, correlationId };
  const envelope = (
    sequence: number,
    category: DevToolEventEnvelope['category'],
    type: string,
    payload: DevToolEventEnvelope['payload'],
  ): DevToolEventEnvelope => ({
    ...base,
    id: `demo-${now}-${sequence}`,
    timestamp: now - 8_000 + sequence * 700,
    sequence,
    category,
    type,
    payload,
  });
  const events = [
    envelope(1, 'navigation', 'route-focus', {
      navigatorId: 'root',
      source: 'react-navigation',
      lifecycle: 'focus',
      action: 'navigate',
      currentRoute: { name: 'Checkout' },
      routePath: ['Home', 'Checkout'],
      actionGroup: 'forward',
    }),
    envelope(2, 'redux', 'action', {
      storeId: 'main',
      actionType: 'checkout/submit',
      action: { type: 'checkout/submit' },
      previousState: { checkout: { status: 'idle' } },
      nextState: { checkout: { status: 'loading' } },
      changedPaths: ['checkout.status'],
      reducerDuration: 1.8,
    }),
    envelope(3, 'console', 'console.warn', {
      level: 'warn',
      arguments: ['Submitting checkout'],
      message: 'Submitting checkout',
      source: { file: 'src/screens/Checkout.tsx', line: 84 },
    }),
    envelope(4, 'network', 'request-complete', {
      requestId: 'demo-request',
      transport: 'fetch',
      method: 'POST',
      url: 'https://api.example.test/checkout',
      query: {},
      requestHeaders: { 'content-type': 'application/json' },
      status: 500,
      statusText: 'Internal Server Error',
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: {
        value: { error: 'Payment service unavailable' },
        size: 39,
        truncated: false,
        contentType: 'application/json',
      },
      startedAt: now - 5_400,
      endedAt: now - 4_750,
      duration: 650,
      timingAccuracy: 'measured',
    }),
    envelope(5, 'native-log', 'native-log', {
      platform: 'ios',
      level: 'error',
      message: 'PaymentService returned HTTP 500',
      loggedAt: now - 4_600,
      pid: 4242,
      process: 'PulseRNDemo',
      subsystem: 'dev.pulsern.demo',
      category: 'network',
    }),
    envelope(6, 'performance', 'screen-interactive', {
      metric: 'screen_interactive',
      name: 'Checkout',
      value: 1_420,
      unit: 'ms',
      approximate: true,
      provenance: 'javascript',
    }),
    envelope(7, 'storage', 'storage-get', {
      requestId: 'demo-storage',
      providerId: 'async-storage',
      operation: 'get',
      key: 'checkout-draft',
      success: true,
      mutation: false,
      duration: 2.4,
    }),
    envelope(8, 'error', 'manual-error', {
      source: 'network',
      classification: 'application',
      name: 'CheckoutError',
      message: 'Checkout failed because the payment service returned 500',
      fatal: false,
      screen: 'Checkout',
      context: [],
      correlations: {
        route: 'Home/Checkout',
        requestId: 'demo-request',
        reduxEventId: `demo-${now}-2`,
        consoleEventId: `demo-${now}-3`,
        performanceEventId: `demo-${now}-6`,
      },
    }),
  ];
  return {
    device: {
      connectionId: `demo-connection-${now}`,
      deviceId,
      sessionId,
      appId,
      protocolVersion: '1.0.0',
      trustStatus: 'loopback',
      connectedAt: now - 8_000,
      device: {
        name: 'Demo iPhone',
        platform: 'ios',
        appName: 'PulseRN Demo',
        appVersion: '1.0.0',
        sdkVersion: '1.0.6',
      },
    },
    events,
  };
}
