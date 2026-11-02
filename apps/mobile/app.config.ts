import type { ExpoConfig } from 'expo/config';
// Native Google Maps SDK keys come from the environment at build time (EAS secrets or local .env via `expo start`).
// Restrict them to the Android package + SHA-1 and the iOS bundle id in Cloud Console.
const config: ExpoConfig = {
  name: 'StormRoute', slug: 'stormroute', version: '0.1.0', orientation: 'portrait', scheme: 'stormroute', userInterfaceStyle: 'automatic',
  ios: { bundleIdentifier: 'com.stormroute.app', config: { googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY ?? '' },
    infoPlist: { NSLocationWhenInUseUsageDescription: 'StormRoute shows your position on the map while you knock doors and builds routes from where you are.' } },
  android: { package: 'com.stormroute.app', permissions: ['ACCESS_FINE_LOCATION'], config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ?? '' } } },
  plugins: ['expo-location', 'expo-sqlite'],
  extra: { eas: { projectId: 'replace-me' } },
};
export default config;
