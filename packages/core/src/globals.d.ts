// The only platform API core uses beyond plain JavaScript. Browsers have it;
// the phone app gets it from react-native-get-random-values (imported first
// thing at startup). Used by newDeviceId() in lib/devices.ts.
declare const crypto: { getRandomValues<T extends ArrayBufferView>(array: T): T };
