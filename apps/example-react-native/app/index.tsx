import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ReactNativeDevTool } from '@pulse-rn/sdk';
import { createAsyncStorageProvider, createMMKVStorageProvider } from '@pulse-rn/sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMMKV } from 'react-native-mmkv';
import { createDevToolMiddleware } from '@pulse-rn/redux-plugin';
import { applyMiddleware, createStore } from 'redux';
import { navigationTracker } from '../navigation';

// Android Emulator reaches the host through 10.0.2.2. Set EXPO_PUBLIC_PULSE_RN_HOST
// to the development machine's LAN address for physical devices.
const host =
  process.env.EXPO_PUBLIC_PULSE_RN_HOST ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
const mmkv = createMMKV({ id: 'pulse-rn-example' });

interface DemoState {
  count: number;
  profile: { name: string; token: string };
}

const initialState: DemoState = {
  count: 0,
  profile: { name: 'PulseRN developer', token: 'redux-state-secret' },
};

function demoReducer(state = initialState, action: { type: string; payload?: unknown }): DemoState {
  if (action.type === 'counter/increment') return { ...state, count: state.count + 1 };
  if (action.type === 'profile/rename' && typeof action.payload === 'string') {
    return { ...state, profile: { ...state.profile, name: action.payload } };
  }
  return state;
}

const reduxMiddleware = createDevToolMiddleware({
  client: ReactNativeDevTool,
  storeId: 'example',
  captureState: true,
  captureStateDiff: true,
  maxStateDepth: 10,
  redactedFields: ['token'],
});
const demoStore = createStore(demoReducer, applyMiddleware(reduxMiddleware));

export default function HomeScreen() {
  const router = useRouter();
  const [sent, setSent] = useState(0);
  const [networkSent, setNetworkSent] = useState(0);
  const [reduxCount, setReduxCount] = useState(demoStore.getState().count);

  useEffect(() => {
    if (!__DEV__) return;
    const client = ReactNativeDevTool.configure({
      host,
      port: 9090,
      appName: 'PulseRN Example',
      appId: 'dev.pulsern.example',
      appVersion: Constants.expoConfig?.version,
      device: {
        name: `${Platform.OS} example`,
        platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'unknown',
        platformVersion: String(Platform.Version),
      },
      redaction: {
        fields: ['password', 'otp', 'token', 'accessToken'],
        headers: ['authorization', 'cookie'],
      },
      enableConsole: true,
      captureConsoleStackTrace: true,
      enableNetwork: true,
      captureRequestBodies: true,
      captureResponseBodies: true,
      maxNetworkBodyBytes: 100 * 1024,
      enablePerformance: true,
      performanceSampleIntervalMs: 1_000,
      javascriptStallThresholdMs: 100,
      captureMemory: true,
      enableStorage: true,
      enableErrors: true,
    });
    const unregisterStorage = client.registerStorageProvider(
      createAsyncStorageProvider(AsyncStorage),
    );
    const unregisterMMKV = client.registerStorageProvider(
      createMMKVStorageProvider(mmkv, {
        id: 'mmkv-example',
        name: 'MMKV · example',
      }),
    );
    client.connect();
    void AsyncStorage.multiSet([
      ['pulse-rn:theme', 'dark'],
      ['pulse-rn:session', JSON.stringify({ user: 'example-developer', token: 'storage-secret' })],
    ]);
    mmkv.set('pulse-rn:launch-count', (mmkv.getNumber('pulse-rn:launch-count') ?? 0) + 1);
    mmkv.set('pulse-rn:feature-enabled', true);
    mmkv.set(
      'pulse-rn:profile',
      JSON.stringify({ user: 'mmkv-developer', token: 'mmkv-storage-secret' }),
    );
    ReactNativeDevTool.performance.appStarted();
    ReactNativeDevTool.performance.startScreen('Home');
    ReactNativeDevTool.performance.screenMounted('Home');
    const interactiveTimer = setTimeout(
      () => ReactNativeDevTool.performance.screenInteractive('Home'),
      250,
    );
    client.track({
      category: 'system',
      type: 'example.started',
      payload: { runtime: Platform.OS, host },
    });
    navigationTracker.track({
      lifecycle: 'ready',
      route: { name: 'Home', path: '/' },
    });
    const unsubscribe = demoStore.subscribe(() => setReduxCount(demoStore.getState().count));
    return () => {
      clearTimeout(interactiveTimer);
      ReactNativeDevTool.performance.endScreen('Home');
      unregisterStorage();
      unregisterMMKV();
      unsubscribe();
      client.disconnect();
    };
  }, []);

  const sendTestEvent = () => {
    const circular: Record<string, unknown> = {
      count: sent + 1,
      token: 'this value will be redacted',
      screen: 'Phase 2 example',
    };
    circular.self = circular;
    console.log('Checkout button pressed', circular);
    console.info('Requesting checkout configuration', { attempt: sent + 1 });
    console.warn('Example slow operation', { duration: 420 });
    console.debug('Debug context', { platform: Platform.OS });
    console.error(new Error('Example error for the Console inspector'));
    ReactNativeDevTool.track({
      category: 'interaction',
      type: 'example.console-demo',
      payload: { count: sent + 1 },
    });
    setSent((value) => value + 1);
  };

  const sendNetworkDemo = async () => {
    const attempt = networkSent + 1;
    setNetworkSent(attempt);
    try {
      await fetch(
        `https://jsonplaceholder.typicode.com/posts/1?token=demo-secret&attempt=${attempt}`,
      );
      await fetch('https://jsonplaceholder.typicode.com/posts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer demo-secret',
        },
        body: JSON.stringify({
          title: 'PulseRN network demo',
          token: 'request-secret',
          attempt,
        }),
      });
    } catch (error) {
      console.warn('Network demo failed', error);
    }
  };

  const sendReduxDemo = () => {
    demoStore.dispatch({
      type: 'counter/increment',
      payload: { source: 'button', token: 'redux-action-secret' },
    });
    if (demoStore.getState().count % 3 === 0) {
      demoStore.dispatch({ type: 'profile/rename', payload: `Developer ${Date.now()}` });
    }
  };

  const openDetails = () => {
    router.push('/details');
  };

  const runPerformanceDemo = () => {
    ReactNativeDevTool.performance.mark('demo-start');
    const blockedUntil = Date.now() + 140;
    while (Date.now() < blockedUntil) {
      // Deliberately creates a visible custom long-task measurement in the example.
    }
    ReactNativeDevTool.performance.mark('demo-complete');
    ReactNativeDevTool.performance.measure('Example long task', 'demo-start', 'demo-complete');
  };

  const captureErrorDemo = () => {
    ReactNativeDevTool.captureError(new Error('Example checkout error'), {
      source: 'react_boundary',
      componentStack: '\n    at CheckoutScreen\n    at ExampleErrorBoundary',
      metadata: { operation: 'checkout', token: 'error-secret' },
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>PULSERN SDK</Text>
        <Text style={styles.title}>PulseRN phase demos</Text>
        <Text style={styles.body}>Desktop endpoint: ws://{host}:9090</Text>
        <Pressable style={styles.button} onPress={sendTestEvent}>
          <Text style={styles.buttonText}>Emit console demo</Text>
        </Pressable>
        <Text style={styles.counter}>{sent} console demos emitted</Text>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={sendNetworkDemo}>
          <Text style={styles.buttonText}>Run network demo</Text>
        </Pressable>
        <Text style={styles.counter}>{networkSent} network demos requested</Text>
        <Pressable style={[styles.button, styles.reduxButton]} onPress={sendReduxDemo}>
          <Text style={styles.buttonText}>Dispatch Redux action</Text>
        </Pressable>
        <Text style={styles.counter}>Redux counter: {reduxCount}</Text>
        <Pressable style={[styles.button, styles.navigationButton]} onPress={openDetails}>
          <Text style={styles.buttonText}>Open navigation demo</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.performanceButton]} onPress={runPerformanceDemo}>
          <Text style={styles.buttonText}>Run performance demo</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.errorButton]} onPress={captureErrorDemo}>
          <Text style={styles.buttonText}>Capture error-boundary demo</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0d12' },
  container: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  eyebrow: { color: '#8d75ff', fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  title: { color: '#f1f3f8', fontSize: 30, fontWeight: '700', marginTop: 10 },
  body: { color: '#8e97a9', fontSize: 15, marginTop: 12, marginBottom: 30 },
  button: { alignItems: 'center', backgroundColor: '#745cff', borderRadius: 10, padding: 16 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  counter: { color: '#687085', marginTop: 16, textAlign: 'center' },
  secondaryButton: { backgroundColor: '#247b65', marginTop: 24 },
  reduxButton: { backgroundColor: '#5e46b5', marginTop: 24 },
  navigationButton: { backgroundColor: '#326d91', marginTop: 24 },
  performanceButton: { backgroundColor: '#8a5c27', marginTop: 24 },
  errorButton: { backgroundColor: '#8f3344', marginTop: 24 },
});
