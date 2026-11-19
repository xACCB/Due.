import { Tabs } from "expo-router/js-tabs";
import { useApp } from "../../state/appContext";

// The main screens, switched in place like the web's activeTab (no tab bar:
// the sidebar drawer, components/Sidebar.tsx, is the way between them, as on
// the web). A short fade on each switch, the web's .sec-body entrance.
// backBehavior "history" lets Focus Mode's Exit go back to the screen before.
export default function ScreensLayout() {
  const { T, ms } = useApp();
  return (
    <Tabs
      tabBar={() => null}
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        animation: "fade",
        transitionSpec: { animation: "timing", config: { duration: ms(200) } },
        sceneStyle: { backgroundColor: T.bg },
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="calendar" />
      {/* Loaded at launch, not on first visit: its tick finishes a Pomodoro or break that ran
          out while the app was closed, wherever you are, as the web's timer does. */}
      <Tabs.Screen name="focus" options={{ lazy: false }} />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="import" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
