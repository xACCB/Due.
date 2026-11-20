import { Alert, Linking } from "react-native";
import { requestNotifications } from "./notifications";

// Turning reminders on or off, from Settings -> Reminders or Profile -> This
// device. On asks iOS for permission first (its prompt shows once); if it's
// been refused, an alert offers the iPhone's Settings instead.
export async function turnReminders(on: boolean, setNotifications: (on: boolean) => void): Promise<void> {
  if (!on) { setNotifications(false); return; }
  if (await requestNotifications()) { setNotifications(true); return; }
  Alert.alert("Notifications are off", "Allow notifications for DuePlanner in the iPhone's Settings to get reminders.", [
    { text: "Not now", style: "cancel" },
    { text: "Open Settings", onPress: () => { Linking.openSettings().catch(() => {}); } },
  ]);
}
