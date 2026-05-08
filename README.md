# FEeLs Vault

FEeLs Vault is a React Native app that connects to FEeLS, syncs upcoming deadlines, and lets you add custom tasks and notes. It focuses on fast access, offline-friendly cached data, and reliable reminders.

## Main Features

- Secure login using the device keychain
- FEeLS calendar scraping and sync
- Cached deadlines shown during sync and after relaunch
- Custom deadline creation, edit, delete, and undo
- Local notifications with configurable reminder offset
- Quick Notes with persistent storage
- Share formatted deadline lists
- Swipe actions for edit and delete
- Customizable share templates (header, item format, divider)

## Quick Start

```sh
npm install
npm start
```

In a separate terminal:

```sh
npm run android
```

## Scripts

- `npm start`: Start Metro
- `npm run android`: Build and run Android app
- `npm run ios`: Build and run iOS app
- `npm test`: Run tests

## Notes

- The app uses `react-native-bootsplash` for the splash screen.
- Notification reminders are scheduled using `@notifee/react-native`.
