import { Platform } from "react-native";
import { readJSON, writeJSON } from "./storage";

// This phone's id in the account's device list (users/{uid}/meta/devices):
// 24 hex characters as the rules require, made once and kept across sign-outs
// (hw-device-id, as on the web). Core's newDeviceId() needs
// crypto.getRandomValues, which React Native doesn't have without a native
// package; the id only has to be unique, not secret, so Math.random serves.
export function thisDeviceId(): string {
  const saved = readJSON<unknown>("hw-device-id", null);
  if (typeof saved === "string" && /^[0-9a-f]{24}$/.test(saved)) return saved;
  let id = "";
  for (let i = 0; i < 24; i++) id += Math.floor(Math.random() * 16).toString(16);
  writeJSON("hw-device-id", id);
  return id;
}

// How the list names this device: the web's describeDevice() wording for an
// installed app ("DuePlanner app on iPhone").
export function thisDeviceName(): string {
  if (Platform.OS === "ios") {
    const idiom = (Platform.constants as { interfaceIdiom?: string }).interfaceIdiom;
    return `DuePlanner app on ${idiom === "pad" ? "iPad" : "iPhone"}`;
  }
  return Platform.OS === "android" ? "DuePlanner app on Android" : "DuePlanner app";
}

// The account whose list the server has confirmed holds this device
// (hw-device-registered, as on the web). Written only after that
// confirmation: until then, a missing entry means "add me", never "signed out".
export const registeredFor = (): string | null => readJSON<string | null>("hw-device-registered", null);
export const setRegisteredFor = (uid: string | null): void => writeJSON("hw-device-registered", uid);
