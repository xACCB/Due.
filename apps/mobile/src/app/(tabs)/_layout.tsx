import { useEffect } from "react";
import { Tabs } from "expo-router/js-tabs";
import { useApp } from "../../state/appContext";
import { setSelectedTab } from "../../lib/selectedTab";

// No tab bar is drawn; this only reports which screen is showing (ScreenBody).
function TabState({ name }: { name: string }) {
  useEffect(() => { setSelectedTab(name); }, [name]);
  return null;
}

// The main screens, switched in place like the web's activeTab (no tab bar:
// the sidebar drawer, components/Sidebar.tsx, is the way between them, as on
// the web). The switch itself is instant, as the web's is; each screen's
// content then enters as the web's .sec-body does (components/ScreenBody.tsx),
// while the header stays still. (A crossfade of whole screens showed both at
// once for a moment, titles overlapping.)
// backBehavior "history" lets Focus Mode's Exit go back to the screen before.
export default function ScreensLayout() {
  const { T } = useApp();
  return (
    <Tabs
      tabBar={({ state }) => <TabState name={state.routes[state.index]?.name ?? ""} />}
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        animation: "none",
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
