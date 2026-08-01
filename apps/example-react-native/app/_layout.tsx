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
      ...(previous
        ? { previousRoute: { key: `expo:${previous}`, name: previous, path: previous } }
        : {}),
      route: {
        key: `expo:${pathname}`,
        name: pathname === '/' ? 'Home' : pathname,
        path: pathname,
        params: pathname === '/details' ? { itemId: 42, token: 'route-secret' } : undefined,
      },
      rootState: {
        index: 0,
        routes: [
          {
            key: 'expo-stack',
            name: 'RootStack',
            state: {
              index: 0,
              routes: [
                {
                  key: `expo:${pathname}`,
                  name: pathname === '/' ? 'Home' : pathname,
                  path: pathname,
                },
              ],
            },
          },
        ],
      },
      integrationMetadata: { pathname },
    });
    previousPath.current = pathname;
  }, [pathname]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
