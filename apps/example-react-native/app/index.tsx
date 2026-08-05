import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createAnimationWorkletProfiler,
  createAsyncStorageProvider,
  createDevToolMiddleware,
  createMMKVStorageProvider,
  ReactNativeDevTool,
} from '@pulse-rn/sdk';
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMMKV } from 'react-native-mmkv';
import { applyMiddleware, createStore } from 'redux';
import { navigationTracker } from '../navigation';
import { runLineDebuggerDemo, runUnhandledDebuggerDemo } from '../debugger-demo';

// Android Emulator reaches the host through 10.0.2.2. Set EXPO_PUBLIC_PULSE_RN_HOST
// to the development machine's LAN address for physical devices.
const host =
  process.env.EXPO_PUBLIC_PULSE_RN_HOST ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
const devToolPort = Number(process.env.EXPO_PUBLIC_PULSE_RN_PORT ?? 9090);
const pairingCode = process.env.EXPO_PUBLIC_PULSE_RN_PAIRING_CODE;
const reconnectToken = process.env.EXPO_PUBLIC_PULSE_RN_RECONNECT_TOKEN;
const secure = process.env.EXPO_PUBLIC_PULSE_RN_SECURE === 'true';
const mmkv = createMMKV({ id: 'pulse-rn-example' });
const animationProfiler = createAnimationWorkletProfiler(ReactNativeDevTool, {
  isDevelopment: __DEV__,
  sampleIntervalMs: 100,
  maxSamplesPerAnimation: 20,
});

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
  maxStateProperties: 5_000,
  maxStateBytes: 512 * 1024,
  stateSizeWarningBytes: 256 * 1024,
  actionCategories: {
    counter: ['counter/*'],
    profile: ['profile/*'],
  },
  enabledCategories: ['counter', 'profile'],
  actionDenyList: ['@@redux/*'],
  getCorrelationContext: (action) => ({
    route: 'Home',
    correlationId: `redux:${String((action as { type?: unknown }).type ?? 'unknown')}`,
  }),
  redactedFields: ['token'],
});
const demoStore = createStore(demoReducer, applyMiddleware(reduxMiddleware));

export default function HomeScreen() {
  const router = useRouter();
  const [sent, setSent] = useState(0);
  const [networkSent, setNetworkSent] = useState(0);
  const [reduxCount, setReduxCount] = useState(demoStore.getState().count);
  const [debuggerResult, setDebuggerResult] = useState('Not run');
  const [animationResult, setAnimationResult] = useState('Not run');
  const animatedProgress = useSharedValue(0);
  const activeAnimationId = useSharedValue('');
  const lastReportedBucket = useSharedValue(-1);
  const animatedBoxStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: animatedProgress.value * 190 },
      { rotate: `${animatedProgress.value * 360}deg` },
    ],
    opacity: 0.45 + animatedProgress.value * 0.55,
  }));

  const reportAnimationSample = (id: string, value: number) => {
    animationProfiler.animation.sample(id, value, Date.now(), value);
  };

  useAnimatedReaction(
    () => Math.round(animatedProgress.value * 10),
    (bucket, previousBucket) => {
      if (
        activeAnimationId.value &&
        bucket !== previousBucket &&
        bucket !== lastReportedBucket.value
      ) {
        lastReportedBucket.value = bucket;
        scheduleOnRN(reportAnimationSample, activeAnimationId.value, animatedProgress.value);
      }
    },
  );

  useEffect(() => {
    if (!__DEV__) return;
    const client = ReactNativeDevTool.configure({
      host,
      port: devToolPort,
      secure,
      ...(pairingCode ? { pairingCode } : {}),
      ...(reconnectToken ? { reconnectToken } : {}),
      appName: 'PulseRN Example',
      environment: 'development',
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
      maxConsoleEventsPerMinute: 6_000,
      consoleSerialization: {
        maxDepth: 8,
        maxProperties: 200,
        maxStringLength: 20_000,
      },
      enableNetwork: true,
      captureRequestBodies: true,
      captureResponseBodies: true,
      maxNetworkBodyBytes: 100 * 1024,
      maxNetworkRequestBytes: 256 * 1024,
      maxNetworkSessionBytes: 10 * 1024 * 1024,
      enablePerformance: true,
      performanceSampleIntervalMs: 1_000,
      javascriptStallThresholdMs: 100,
      captureMemory: true,
      enableStorage: true,
      enableErrors: true,
      categories: {
        console: true,
        network: true,
        redux: true,
        navigation: true,
        performance: true,
        animation: true,
        worklet: true,
        storage: true,
        error: true,
      },
      sampling: { performance: 1, animation: 1, worklet: 1, console: 1, network: 1 },
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
      route: { key: 'expo:/', name: 'Home', path: '/' },
    });
    animationProfiler.runtime.capability('available');
    animationProfiler.runtime.created({
      id: 'ui-runtime',
      name: 'Reanimated UI',
      kind: 'ui',
      mode: 'legacy',
      eventLoopEnabled: true,
      animationQueuePollingRate: 16,
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

  const runDebuggerDemo = async () => {
    const result = await runLineDebuggerDemo(sent + 1);
    setDebuggerResult(result);
  };

  const finishAnimationDemo = (id: string, finished: boolean | undefined, finalValue: number) => {
    animationProfiler.animation.phase(id, finished ? 'completed' : 'cancelled', {
      value: finalValue,
      completionRuntime: 'react-native',
    });
    setAnimationResult(finished ? 'Completed on UI runtime' : 'Cancelled');
  };

  const runAnimationDemo = () => {
    const returning = animatedProgress.value > 0.5;
    const target = returning ? 0 : 1;
    const type = returning ? 'spring' : 'timing';
    const correlationId = `animation-demo:${Date.now()}`;
    const id = animationProfiler.animation.create({
      type,
      component: 'HomeScreen.AnimationDemo',
      viewTag: 'pulse-demo-box',
      properties: ['transform.translateX', 'transform.rotate', 'opacity'],
      initialValue: animatedProgress.value,
      targetValue: target,
      configuration: returning
        ? { damping: 14, stiffness: 130, mass: 1 }
        : { duration: 850, easing: 'inOut(cubic)' },
      source: { file: 'app/index.tsx', line: 335 },
      runtimeId: 'ui-runtime',
      correlationId,
    });
    activeAnimationId.value = id;
    lastReportedBucket.value = -1;
    animationProfiler.animation.phase(id, 'scheduled');
    animationProfiler.animation.phase(id, 'started');
    setAnimationResult(`${type} running…`);
    const complete = (finished?: boolean) => {
      'worklet';
      scheduleOnRN(finishAnimationDemo, id, finished, target);
    };
    animatedProgress.value = returning
      ? withSpring(target, { damping: 14, stiffness: 130, mass: 1 }, complete)
      : withTiming(target, { duration: 850, easing: Easing.inOut(Easing.cubic) }, complete);
  };

  const runWorkletDemo = () => {
    const workletId = `worklet-demo:${Date.now()}`;
    const enqueuedAt = Date.now();
    ReactNativeDevTool.track({
      category: 'worklet',
      type: 'worklet.scheduled',
      correlationId: workletId,
      payload: {
        schemaVersion: 1,
        operation: 'scheduled',
        timestamp: enqueuedAt,
        runtimeId: 'ui-runtime',
        runtimeName: 'Reanimated UI',
        runtimeKind: 'ui',
        workletId,
        workletName: 'exampleUiWorklet',
        originRuntime: 'react-native',
        destinationRuntime: 'ui',
        enqueuedAt,
        source: { file: 'app/index.tsx', line: 372 },
      },
    });
    setAnimationResult('UI worklet queued…');
    scheduleOnUI(() => {
      'worklet';
      const startedAt = Date.now();
      let checksum = 0;
      for (let index = 0; index < 25_000; index += 1) checksum = (checksum + index) % 97;
      const endedAt = Date.now();
      scheduleOnRN(reportWorkletDemo, workletId, enqueuedAt, startedAt, endedAt, checksum);
    });
  };

  const reportWorkletDemo = (
    workletId: string,
    enqueuedAt: number,
    startedAt: number,
    endedAt: number,
    checksum: number,
  ) => {
    ReactNativeDevTool.track({
      category: 'worklet',
      type: 'worklet.completed',
      correlationId: workletId,
      payload: {
        schemaVersion: 1,
        operation: 'completed',
        timestamp: endedAt,
        runtimeId: 'ui-runtime',
        runtimeName: 'Reanimated UI',
        runtimeKind: 'ui',
        workletId,
        workletName: 'exampleUiWorklet',
        originRuntime: 'react-native',
        destinationRuntime: 'ui',
        enqueuedAt,
        startedAt,
        endedAt,
        queueWaitMs: Math.max(0, startedAt - enqueuedAt),
        durationMs: Math.max(0, endedAt - startedAt),
        metrics: { checksum },
      },
    });
    setAnimationResult(`Worklet completed in ${(endedAt - startedAt).toFixed(2)} ms`);
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
        <View style={styles.animationTrack}>
          <Animated.View style={[styles.animationBox, animatedBoxStyle]} />
        </View>
        <Pressable style={[styles.button, styles.animationButton]} onPress={runAnimationDemo}>
          <Text style={styles.buttonText}>Run Reanimated timing / spring</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.workletButton]} onPress={runWorkletDemo}>
          <Text style={styles.buttonText}>Run UI worklet demo</Text>
        </Pressable>
        <Text style={styles.counter}>Animations: {animationResult}</Text>
        <Pressable style={[styles.button, styles.errorButton]} onPress={captureErrorDemo}>
          <Text style={styles.buttonText}>Capture error-boundary demo</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.debuggerButton]} onPress={runDebuggerDemo}>
          <Text style={styles.buttonText}>Run line debugger demo</Text>
        </Pressable>
        <Text style={styles.counter}>Debugger: {debuggerResult}</Text>
        <Pressable
          style={[styles.button, styles.debuggerExceptionButton]}
          onPress={() => void runUnhandledDebuggerDemo()}
        >
          <Text style={styles.buttonText}>Throw debugger exception</Text>
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
  animationButton: { backgroundColor: '#7046a8', marginTop: 16 },
  workletButton: { backgroundColor: '#247c78', marginTop: 16 },
  animationTrack: {
    backgroundColor: '#171b24',
    borderRadius: 12,
    height: 60,
    marginTop: 24,
    overflow: 'hidden',
    padding: 8,
  },
  animationBox: {
    backgroundColor: '#9b82ff',
    borderRadius: 8,
    height: 44,
    width: 44,
  },
  errorButton: { backgroundColor: '#8f3344', marginTop: 24 },
  debuggerButton: { backgroundColor: '#4656b5', marginTop: 24 },
  debuggerExceptionButton: { backgroundColor: '#6f354c', marginTop: 24 },
});
