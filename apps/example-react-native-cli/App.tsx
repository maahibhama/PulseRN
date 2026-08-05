import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createAnimationWorkletProfiler,
  createDevToolMiddleware,
  createNavigationTracker,
  createAsyncStorageProvider,
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
import { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { applyMiddleware, createStore } from 'redux';
import { runLineDebuggerDemo, runUnhandledDebuggerDemo } from './debugger-demo';

// Android Emulator reaches the development machine through 10.0.2.2.
// Use adb reverse tcp:9090 tcp:9090 for an attached Android device, or replace
// this value with your development machine's LAN address for a physical device.
const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
// For a physical device, paste a short-lived pairing code from PulseRN Connections.
// After pairing, persist the reconnect token reported by `onReconnectToken` in your
// app's secure storage and provide it here on the next launch.
const pairingCode: string | undefined = undefined;
const reconnectToken: string | undefined = undefined;
// Set to true when PulseRN desktop TLS is enabled and this device trusts its certificate.
const secure = false;
const mmkv = createMMKV({ id: 'pulse-rn-cli-example' });
const animationProfiler = createAnimationWorkletProfiler(ReactNativeDevTool, {
  isDevelopment: __DEV__,
  sampleIntervalMs: 100,
  maxSamplesPerAnimation: 20,
});

const navigationTracker = createNavigationTracker({
  client: ReactNativeDevTool,
  navigatorId: 'cli-root',
  source: 'manual',
  integrationMetadata: { integration: 'manual-state-machine' },
  redactedFields: ['token', 'password'],
});

interface DemoState {
  count: number;
  profile: { name: string; token: string };
}

const initialState: DemoState = {
  count: 0,
  profile: { name: 'PulseRN developer', token: 'redux-state-secret' },
};

function demoReducer(
  state = initialState,
  action: { type: string; payload?: unknown },
): DemoState {
  if (action.type === 'counter/increment') {
    return { ...state, count: state.count + 1 };
  }
  if (action.type === 'profile/rename' && typeof action.payload === 'string') {
    return { ...state, profile: { ...state.profile, name: action.payload } };
  }
  return state;
}

const reduxMiddleware = createDevToolMiddleware({
  client: ReactNativeDevTool,
  storeId: 'cli-example',
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
  getCorrelationContext: action => ({
    route: 'Home',
    correlationId: `redux:${String(
      (action as { type?: unknown }).type ?? 'unknown',
    )}`,
  }),
  redactedFields: ['token'],
});
const demoStore = createStore(demoReducer, applyMiddleware(reduxMiddleware));

type Screen = 'home' | 'details';

function App() {
  const [screen, setScreen] = useState<Screen>('home');

  useEffect(() => {
    if (!__DEV__) {
      return;
    }

    const client = ReactNativeDevTool.configure({
      host,
      port: 9090,
      secure,
      ...(pairingCode ? { pairingCode } : {}),
      ...(reconnectToken ? { reconnectToken } : {}),
      appName: 'PulseRN CLI Example',
      environment: 'development',
      appId: 'dev.pulsern.cli-example',
      appVersion: '0.1.0',
      device: {
        name: `${Platform.OS} CLI example`,
        platform:
          Platform.OS === 'ios' || Platform.OS === 'android'
            ? Platform.OS
            : 'unknown',
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
      sampling: {
        performance: 1,
        animation: 1,
        worklet: 1,
        console: 1,
        network: 1,
      },
    });
    const unregisterAsyncStorage = client.registerStorageProvider(
      createAsyncStorageProvider(AsyncStorage),
    );
    const unregisterMMKV = client.registerStorageProvider(
      createMMKVStorageProvider(mmkv, {
        id: 'mmkv-cli-example',
        name: 'MMKV · CLI example',
      }),
    );

    client.connect();
    void AsyncStorage.multiSet([
      ['pulse-rn:theme', 'dark'],
      [
        'pulse-rn:session',
        JSON.stringify({
          user: 'cli-example-developer',
          token: 'storage-secret',
        }),
      ],
    ]);
    mmkv.set(
      'pulse-rn:launch-count',
      (mmkv.getNumber('pulse-rn:launch-count') ?? 0) + 1,
    );
    mmkv.set('pulse-rn:feature-enabled', true);
    mmkv.set(
      'pulse-rn:profile',
      JSON.stringify({
        user: 'mmkv-cli-developer',
        token: 'mmkv-storage-secret',
      }),
    );
    ReactNativeDevTool.performance.appStarted();
    client.track({
      category: 'system',
      type: 'cli-example.started',
      payload: { runtime: Platform.OS, host },
    });
    navigationTracker.track({
      lifecycle: 'ready',
      route: { key: 'cli-home', name: 'Home', path: '/' },
      rootState: {
        index: 0,
        routes: [{ key: 'cli-home', name: 'Home', path: '/' }],
      },
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

    return () => {
      unregisterAsyncStorage();
      unregisterMMKV();
      client.disconnect();
    };
  }, []);

  const openDetails = () => {
    navigationTracker.track({
      lifecycle: 'state',
      action: 'navigate',
      previousRoute: { key: 'cli-home', name: 'Home', path: '/' },
      route: {
        key: 'cli-details',
        name: 'Details',
        path: '/details',
        params: { token: 'navigation-secret' },
      },
      rootState: {
        index: 0,
        routes: [
          {
            key: 'cli-stack',
            name: 'RootStack',
            state: {
              index: 0,
              routes: [
                { key: 'cli-details', name: 'Details', path: '/details' },
              ],
            },
          },
        ],
      },
    });
    setScreen('details');
  };

  const goBack = () => {
    navigationTracker.track({
      lifecycle: 'state',
      action: 'back',
      previousRoute: { key: 'cli-details', name: 'Details', path: '/details' },
      route: { key: 'cli-home', name: 'Home', path: '/' },
      rootState: {
        index: 0,
        routes: [{ key: 'cli-home', name: 'Home', path: '/' }],
      },
    });
    setScreen('home');
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0b0d12" />
      {screen === 'home' ? (
        <HomeScreen onOpenDetails={openDetails} />
      ) : (
        <DetailsScreen onBack={goBack} />
      )}
    </SafeAreaProvider>
  );
}

function HomeScreen({ onOpenDetails }: { onOpenDetails: () => void }) {
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
        scheduleOnRN(
          reportAnimationSample,
          activeAnimationId.value,
          animatedProgress.value,
        );
      }
    },
  );

  useEffect(() => {
    ReactNativeDevTool.performance.startScreen('Home');
    ReactNativeDevTool.performance.screenMounted('Home');
    const interactiveTimer = setTimeout(
      () => ReactNativeDevTool.performance.screenInteractive('Home'),
      250,
    );
    const unsubscribe = demoStore.subscribe(() =>
      setReduxCount(demoStore.getState().count),
    );
    return () => {
      clearTimeout(interactiveTimer);
      ReactNativeDevTool.performance.endScreen('Home');
      unsubscribe();
    };
  }, []);

  const sendConsoleDemo = () => {
    const circular: Record<string, unknown> = {
      count: sent + 1,
      token: 'this value will be redacted',
      screen: 'React Native CLI example',
    };
    circular.self = circular;
    console.log('Checkout button pressed', circular);
    console.info('Requesting checkout configuration', { attempt: sent + 1 });
    console.warn('Example slow operation', { duration: 420 });
    console.debug('Debug context', { platform: Platform.OS });
    console.error(new Error('Example error for the Console inspector'));
    ReactNativeDevTool.track({
      category: 'interaction',
      type: 'cli-example.console-demo',
      payload: { count: sent + 1 },
    });
    setSent(value => value + 1);
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
      demoStore.dispatch({
        type: 'profile/rename',
        payload: `Developer ${Date.now()}`,
      });
    }
  };

  const runPerformanceDemo = () => {
    ReactNativeDevTool.performance.mark('demo-start');
    const blockedUntil = Date.now() + 140;
    while (Date.now() < blockedUntil) {
      // Deliberately creates a visible custom long-task measurement.
    }
    ReactNativeDevTool.performance.mark('demo-complete');
    ReactNativeDevTool.performance.measure(
      'Example long task',
      'demo-start',
      'demo-complete',
    );
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

  const finishAnimationDemo = (
    id: string,
    finished: boolean | undefined,
    finalValue: number,
  ) => {
    animationProfiler.animation.phase(
      id,
      finished ? 'completed' : 'cancelled',
      {
        value: finalValue,
        completionRuntime: 'react-native',
      },
    );
    setAnimationResult(finished ? 'Completed on UI runtime' : 'Cancelled');
  };

  const runAnimationDemo = () => {
    const returning = animatedProgress.value > 0.5;
    const target = returning ? 0 : 1;
    const type = returning ? 'spring' : 'timing';
    const correlationId = `cli-animation-demo:${Date.now()}`;
    const id = animationProfiler.animation.create({
      type,
      component: 'HomeScreen.AnimationDemo',
      viewTag: 'pulse-cli-demo-box',
      properties: ['transform.translateX', 'transform.rotate', 'opacity'],
      initialValue: animatedProgress.value,
      targetValue: target,
      configuration: returning
        ? { damping: 14, stiffness: 130, mass: 1 }
        : { duration: 850, easing: 'inOut(cubic)' },
      source: { file: 'App.tsx', line: 470 },
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
      : withTiming(
          target,
          { duration: 850, easing: Easing.inOut(Easing.cubic) },
          complete,
        );
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
        workletName: 'cliExampleUiWorklet',
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
    setAnimationResult(
      `Worklet completed in ${(endedAt - startedAt).toFixed(2)} ms`,
    );
  };

  const runWorkletDemo = () => {
    const workletId = `cli-worklet-demo:${Date.now()}`;
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
        workletName: 'cliExampleUiWorklet',
        originRuntime: 'react-native',
        destinationRuntime: 'ui',
        enqueuedAt,
        source: { file: 'App.tsx', line: 546 },
      },
    });
    setAnimationResult('UI worklet queued…');
    scheduleOnUI(() => {
      'worklet';
      const startedAt = Date.now();
      let checksum = 0;
      for (let index = 0; index < 25_000; index += 1) {
        checksum = (checksum + index) % 97;
      }
      const endedAt = Date.now();
      scheduleOnRN(
        reportWorkletDemo,
        workletId,
        enqueuedAt,
        startedAt,
        endedAt,
        checksum,
      );
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>PULSERN SDK · COMMUNITY CLI</Text>
        <Text style={styles.title}>PulseRN native demos</Text>
        <Text style={styles.body}>Desktop endpoint: ws://{host}:9090</Text>
        <DemoButton label="Emit console demo" onPress={sendConsoleDemo} />
        <Text style={styles.counter}>{sent} console demos emitted</Text>
        <DemoButton
          label="Run network demo"
          onPress={sendNetworkDemo}
          color="#247b65"
        />
        <Text style={styles.counter}>
          {networkSent} network demos requested
        </Text>
        <DemoButton
          label="Dispatch Redux action"
          onPress={sendReduxDemo}
          color="#5e46b5"
        />
        <Text style={styles.counter}>Redux counter: {reduxCount}</Text>
        <DemoButton
          label="Open navigation demo"
          onPress={onOpenDetails}
          color="#326d91"
        />
        <DemoButton
          label="Run performance demo"
          onPress={runPerformanceDemo}
          color="#8a5c27"
        />
        <View style={styles.animationTrack}>
          <Animated.View style={[styles.animationBox, animatedBoxStyle]} />
        </View>
        <DemoButton
          label="Run Reanimated timing / spring"
          onPress={runAnimationDemo}
          color="#7046a8"
        />
        <DemoButton
          label="Run UI worklet demo"
          onPress={runWorkletDemo}
          color="#247c78"
        />
        <Text style={styles.counter}>Animations: {animationResult}</Text>
        <DemoButton
          label="Capture error-boundary demo"
          onPress={captureErrorDemo}
          color="#8f3344"
        />
        <DemoButton
          label="Run line debugger demo"
          onPress={runDebuggerDemo}
          color="#4656b5"
        />
        <Text style={styles.counter}>Debugger: {debuggerResult}</Text>
        <DemoButton
          label="Throw debugger exception"
          onPress={() => void runUnhandledDebuggerDemo()}
          color="#6f354c"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function DemoButton({
  label,
  onPress,
  color = '#745cff',
}: {
  label: string;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable
      style={[styles.button, { backgroundColor: color }]}
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function DetailsScreen({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    ReactNativeDevTool.performance.startScreen('Details');
    ReactNativeDevTool.performance.screenMounted('Details');
    const timer = setTimeout(
      () => ReactNativeDevTool.performance.screenInteractive('Details'),
      180,
    );
    return () => {
      clearTimeout(timer);
      ReactNativeDevTool.performance.endScreen('Details');
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.details}>
        <Text style={[styles.eyebrow, styles.detailsEyebrow]}>
          NAVIGATION DEMO
        </Text>
        <Text style={styles.title}>Details screen</Text>
        <Text style={styles.detailsBody}>
          Open the desktop Navigation panel to inspect this native transition
          and its redacted parameters.
        </Text>
        <DemoButton label="Go back" onPress={onBack} color="#326d91" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0d12' },
  container: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  eyebrow: {
    color: '#8d75ff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
  },
  title: {
    color: '#f1f3f8',
    fontSize: 30,
    fontWeight: '700',
    marginTop: 10,
  },
  body: { color: '#8e97a9', fontSize: 15, marginBottom: 14, marginTop: 12 },
  button: {
    alignItems: 'center',
    borderRadius: 10,
    marginTop: 16,
    padding: 16,
  },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  counter: { color: '#687085', marginTop: 10, textAlign: 'center' },
  animationTrack: {
    backgroundColor: '#171b24',
    borderRadius: 12,
    height: 60,
    marginTop: 16,
    overflow: 'hidden',
    padding: 8,
  },
  animationBox: {
    backgroundColor: '#9b82ff',
    borderRadius: 8,
    height: 44,
    width: 44,
  },
  details: { flex: 1, justifyContent: 'center', padding: 28 },
  detailsEyebrow: { color: '#70bdf5' },
  detailsBody: {
    color: '#8e97a9',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 14,
    marginTop: 12,
  },
});

export default App;
