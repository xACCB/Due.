// Settings -> Task list -> Sound when done (off by default): a short two-note
// sound as a task is marked done, the same notes as the website's playDone()
// (apps/web/src/lib/dom.ts), from assets/sounds/done.wav. It follows the
// phone's silent switch and plays over music rather than stopping it.
// Best effort: if audio isn't available it does nothing.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import done from "../../assets/sounds/done.wav";

let player: AudioPlayer | null = null;

export function playDone(): void {
  try {
    if (!player) {
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" }).catch(() => {});
      player = createAudioPlayer(done);
    }
    player.seekTo(0).catch(() => {});
    player.play();
  } catch { /* no audio */ }
}
