// Boots the game: the title screen, or a fight straight away with the URL
// shortcuts ?p1=&p2=, ?mode=training or ?cpu=easy|normal|hard (src/scenes/game.ts).
import { startGame } from "./scenes/game";

const canvas = document.getElementById("game");
const overlay = document.getElementById("debug-overlay");

if (!(canvas instanceof HTMLCanvasElement) || !(overlay instanceof HTMLElement)) {
  throw new Error("index.html is missing #game or #debug-overlay");
}

startGame({ canvas, overlay, search: window.location.search }).catch((err: unknown) => {
  console.error("Failed to start the game", err);
});
