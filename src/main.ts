// Boots the game: the title screen, or a fight straight away with the URL
// shortcuts ?p1=&p2=, ?mode=training or ?cpu=easy|normal|hard (src/scenes/game.ts).
// Spec 014: the screen-reader announcer listens to the same hooks as audio,
// and anything that stops the game from starting shows the failure screen.
// Spec 015: the touch controls and the rotate screen live in index.html.
import { createPageAnnouncer } from "./a11y/announcer";
import { bindAudioControls, createAudio } from "./audio";
import { startGame } from "./scenes/game";
import { showFailure } from "./shell/failure";

const fail = (err: unknown) => {
  console.error("Failed to start the game", err);
  showFailure(document, err);
};

try {
  const canvas = document.getElementById("game");
  const overlay = document.getElementById("debug-overlay");
  if (!(canvas instanceof HTMLCanvasElement) || !(overlay instanceof HTMLElement)) {
    throw new Error("index.html is missing #game or #debug-overlay");
  }

  // Audio (spec 010): the AudioContext is created on the first click or key press; M mutes.
  const audio = createAudio();
  bindAudioControls(window, audio);
  // On touch, the end of a tap is what counts as a user gesture for audio (pointerdown is not).
  const resumeAudio = () => audio.resume();
  window.addEventListener("pointerup", resumeAudio, { capture: true });
  window.addEventListener("touchend", resumeAudio, { capture: true, passive: true });
  const announcer = createPageAnnouncer(document, canvas);

  startGame({
    canvas,
    overlay,
    touchControls: document.getElementById("touch-controls"),
    rotateScreen: document.getElementById("rotate-screen"),
    search: window.location.search,
    hooks: {
      simEvents: (events, state) => {
        audio.onEvents(events, state);
        announcer.simEvents(events, state);
      },
      ui: (kind) => audio.ui(kind),
      scene: (name, mode, detail) => {
        if (name === "fight" || name === "versus") audio.music("fight");
        else if (name === "title" || name === "select" || name === "results") audio.music("select");
        announcer.scene(name, mode, detail);
      },
    },
    onFatal: (err) => {
      audio.music(null);
      showFailure(document, err);
    },
    soundMuted: () => audio.muted,
  }).catch(fail);
} catch (err) {
  fail(err);
}
