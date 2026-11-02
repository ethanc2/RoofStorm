import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MapScreen } from './src/screens/MapScreen';
export default function App() {
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><StatusBar style="auto" /><MapScreen /></SafeAreaProvider></GestureHandlerRootView>;
}
