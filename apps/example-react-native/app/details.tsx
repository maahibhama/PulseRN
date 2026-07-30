import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { ReactNativeDevTool } from '@pulse-rn/sdk';

export default function DetailsScreen() {
  const router = useRouter();
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
  const goBack = () => {
    router.back();
  };
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.eyebrow}>NAVIGATION DEMO</Text>
        <Text style={styles.title}>Details route</Text>
        <Text style={styles.body}>
          Open the desktop Navigation panel to inspect this transition and its redacted parameters.
        </Text>
        <Pressable style={styles.button} onPress={goBack}>
          <Text style={styles.buttonText}>Go back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0d12' },
  container: { flex: 1, justifyContent: 'center', padding: 28 },
  eyebrow: { color: '#70bdf5', fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  title: { color: '#f1f3f8', fontSize: 30, fontWeight: '700', marginTop: 10 },
  body: { color: '#8e97a9', fontSize: 15, lineHeight: 22, marginBottom: 30, marginTop: 12 },
  button: { alignItems: 'center', backgroundColor: '#326d91', borderRadius: 10, padding: 16 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
});
