// The only platform API core uses beyond plain JavaScript. Browsers have it;
// React Native doesn't, so the phone app makes its device id itself
// (apps/mobile/src/lib/thisDevice.ts). Used by newDeviceId() in lib/devices.ts.
declare const crypto: { getRandomValues<T extends ArrayBufferView>(array: T): T };
