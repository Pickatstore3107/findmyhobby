import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts, Archivo_400Regular, Archivo_600SemiBold, Archivo_800ExtraBold } from '@expo-google-fonts/archivo';
import { AuthProvider, useAuth } from '@/lib/auth';
import { C } from '@/lib/theme';

function Root() {
  const { me, ready } = useAuth();
  const [fonts] = useFonts({ Archivo_400Regular, Archivo_600SemiBold, Archivo_800ExtraBold });
  if (!ready || !fonts) return null; // the native splash screen stays up until both are ready

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
        {/* Signed-out users only ever see the welcome screen; signed-in users never see it. */}
        <Stack.Protected guard={!me}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={!!me}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="activity/[id]" />
          <Stack.Screen name="tournament/[id]" />
          <Stack.Screen name="ticket/[ref]" options={{ presentation: 'formSheet', sheetGrabberVisible: true, sheetAllowedDetents: [0.94], sheetCornerRadius: 0 }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
      <AuthProvider><Root /></AuthProvider>
    </GestureHandlerRootView>
  );
}
