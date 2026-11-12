import { startSandbox } from "./scenes/sandbox";

const canvas = document.getElementById("game");
const overlay = document.getElementById("debug-overlay");

if (!(canvas instanceof HTMLCanvasElement) || !(overlay instanceof HTMLElement)) {
  throw new Error("index.html is missing #game or #debug-overlay");
}

startSandbox({ canvas, overlay, search: window.location.search }).catch((err: unknown) => {
  console.error("Failed to start the sandbox", err);
});
