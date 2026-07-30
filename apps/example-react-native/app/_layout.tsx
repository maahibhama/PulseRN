import { Stack, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { navigationTracker } from '../navigation';

export default function RootLayout() {
  const pathname = usePathname();
  const previousPath = useRef<string | undefined>(undefined);

  useEffect(() => {
    const previous = previousPath.current;
    navigationTracker.track({
      lifecycle: previous ? 'state' : 'ready',
      action: previous ? 'navigate' : 'unknown',
      ...(previous ? { previousRoute: { name: previous, path: previous } } : {}),
      route: {
        name: pathname === '/' ? 'Home' : pathname,
        path: pathname,
        params: pathname === '/details' ? { itemId: 42, token: 'route-secret' } : undefined,
      },
    });
    previousPath.current = pathname;
  }, [pathname]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
