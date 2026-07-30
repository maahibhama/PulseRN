import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createDevToolMiddleware,
  createNavigationTracker,
  createAsyncStorageProvider,
  createMMKVStorageProvider,
  ReactNativeDevTool,
} from '@pulse-rn/sdk';
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
const mmkv = createMMKV({ id: 'pulse-rn-cli-example' });

const navigationTracker = createNavigationTracker({
  client: ReactNativeDevTool,
  navigatorId: 'cli-root',
  source: 'manual',
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
      appName: 'PulseRN CLI Example',
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
      route: { name: 'Home', path: '/' },
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
      previousRoute: { name: 'Home', path: '/' },
      route: {
        name: 'Details',
        path: '/details',
        params: { token: 'navigation-secret' },
      },
    });
    setScreen('details');
  };

  const goBack = () => {
    navigationTracker.track({
      lifecycle: 'state',
      action: 'back',
      previousRoute: { name: 'Details', path: '/details' },
      route: { name: 'Home', path: '/' },
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
