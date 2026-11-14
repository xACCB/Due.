import { Circle, Line, Path, Polyline, Rect, Svg } from "react-native-svg";

// The web's icons (apps/web/src/components/icons.tsx), point for point: small
// stroke drawings on a 24x24 grid, so the sidebar and header look the same as
// the website's. `color` is the stroke (the web's currentColor).

type P = { color: string; size?: number };
const base = { fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function IconTasks({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color}>
      <Circle cx="4" cy="6" r="1.3" /><Line x1="8.5" y1="6" x2="20" y2="6" />
      <Circle cx="4" cy="12" r="1.3" /><Line x1="8.5" y1="12" x2="20" y2="12" />
      <Circle cx="4" cy="18" r="1.3" /><Line x1="8.5" y1="18" x2="20" y2="18" />
    </Svg>
  );
}

export function IconImport({ color, size = 16 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color}>
      <Line x1="12" y1="3" x2="12" y2="14" /><Polyline points="7.5,10 12,14.5 16.5,10" />
      <Path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Svg>
  );
}

export function IconCalendar({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color}>
      <Rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><Line x1="3.5" y1="10" x2="20.5" y2="10" />
      <Line x1="8" y1="3" x2="8" y2="7" /><Line x1="16" y1="3" x2="16" y2="7" />
    </Svg>
  );
}

export function IconFocus({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color}>
      <Circle cx="12" cy="12" r="8.5" /><Circle cx="12" cy="12" r="4.5" />
      <Circle cx="12" cy="12" r="0.9" fill={color} stroke="none" />
    </Svg>
  );
}

// A panel with its left column marked: opens and closes the sidebar.
export function IconSidebar({ color, size = 16 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color}>
      <Rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><Line x1="9.5" y1="4.5" x2="9.5" y2="19.5" />
    </Svg>
  );
}

export function IconBell({ color, size = 16 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color}>
      <Path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" />
      <Path d="M10 19a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function IconHistory({ color, size = 16 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color}>
      <Circle cx="12" cy="13" r="8" /><Polyline points="12,9 12,13 15,15" /><Polyline points="8.5,2.5 12,5.5 15.5,2.5" />
    </Svg>
  );
}

export function IconSearch({ color, size = 14 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Circle cx="10.5" cy="10.5" r="6.5" /><Line x1="15.5" y1="15.5" x2="21" y2="21" />
    </Svg>
  );
}

export function IconSettings({ color, size = 16 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke={color}>
      <Circle cx="12" cy="12" r="6.5" /><Circle cx="12" cy="12" r="2.1" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => (
        <Line key={deg} x1="12" y1="4.2" x2="12" y2="1.8" transform={`rotate(${deg} 12 12)`} />
      ))}
    </Svg>
  );
}

// The profile row's person (the web draws it inline in the sidebar).
export function IconPerson({ color, size = 14 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Circle cx="12" cy="8" r="4" /><Path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </Svg>
  );
}

// The subject arrow (the web's chevron polyline).
export function IconChevron({ color, size = 12 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="9,5 16,12 9,19" />
    </Svg>
  );
}
