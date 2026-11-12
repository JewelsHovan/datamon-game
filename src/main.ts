// Boots the game: the title screen, or a fight straight away with the URL
// shortcuts ?p1=&p2=, ?mode=training or ?cpu=easy|normal|hard (src/scenes/game.ts).
import { bindAudioControls, createAudio } from "./audio";
import { startGame } from "./scenes/game";

const canvas = document.getElementById("game");
const overlay = document.getElementById("debug-overlay");

if (!(canvas instanceof HTMLCanvasElement) || !(overlay instanceof HTMLElement)) {
  throw new Error("index.html is missing #game or #debug-overlay");
}

// Audio (spec 010): the AudioContext is created on the first click or key press; M mutes.
const audio = createAudio();
bindAudioControls(window, audio);

startGame({
  canvas,
  overlay,
  search: window.location.search,
  hooks: {
    simEvents: (events, state) => audio.onEvents(events, state.round),
    ui: (kind) => audio.ui(kind),
    scene: (name) => {
      if (name === "fight" || name === "versus") audio.music("fight");
      else if (name === "title" || name === "select" || name === "results") audio.music("select");
    },
  },
}).catch((err: unknown) => {
  console.error("Failed to start the game", err);
});
