import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { ReactNativeDevTool } from '@pulse-rn/sdk';

// Android Emulator reaches the host through 10.0.2.2. Set EXPO_PUBLIC_PULSE_RN_HOST
// to the development machine's LAN address for physical devices.
const host =
  process.env.EXPO_PUBLIC_PULSE_RN_HOST ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');

export default function HomeScreen() {
  const [sent, setSent] = useState(0);

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
    }).connect();
    client.track({
      category: 'system',
      type: 'example.started',
      payload: { runtime: Platform.OS, host },
    });
    return () => client.disconnect();
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

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <Text style={styles.eyebrow}>PULSERN SDK</Text>
        <Text style={styles.title}>Phase 1 connection test</Text>
        <Text style={styles.body}>Desktop endpoint: ws://{host}:9090</Text>
        <Pressable style={styles.button} onPress={sendTestEvent}>
          <Text style={styles.buttonText}>Emit console demo</Text>
        </Pressable>
        <Text style={styles.counter}>{sent} console demos emitted</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0d12' },
  container: { flex: 1, justifyContent: 'center', padding: 28 },
  eyebrow: { color: '#8d75ff', fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  title: { color: '#f1f3f8', fontSize: 30, fontWeight: '700', marginTop: 10 },
  body: { color: '#8e97a9', fontSize: 15, marginTop: 12, marginBottom: 30 },
  button: { alignItems: 'center', backgroundColor: '#745cff', borderRadius: 10, padding: 16 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  counter: { color: '#687085', marginTop: 16, textAlign: 'center' },
});
