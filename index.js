import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
// ✨ NEW IMPORT ✨
import notifee from '@notifee/react-native';

// ✨ NEW: The silent background listener ✨
notifee.onBackgroundEvent(async ({ type, detail }) => {
  // This just tells Android we received the event so it doesn't crash.
  console.log('Background event received', type);
});

AppRegistry.registerComponent(appName, () => App);