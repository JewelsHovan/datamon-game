// Pixel-snapped procedural overlays for signature move beats and defensive outcomes (spec 020).
// Every variant has a reduced-effects-safe path (no additive glare, no rapid expansion/strobing).
import type { Camera } from "./camera";

export type OverlayKind =
  | "charge_smear"
  | "armor_brace"
  | "phase_collapse"
  | "phase_streak"
  | "overhead_arc"
  | "rush_smear"
  | "uppercut_wind"
  | "impact_ring"
  | "perfect_shield_full"
  | "perfect_shield_reduced"
  | "guard_break_full"
  | "guard_break_reduced"
  | "tech_full"
  | "tech_reduced";

export interface Overlay {
  kind: OverlayKind;
  /** Stage pixels. */
  x: number;
  y: number;
  facing: 1 | -1;
  age: number;
  life: number;
  color: string;
  accent?: string;
  /** Optional target delta X in pixels (e.g. phase_streak travel). */
  dx?: number;
  reduced: boolean;
}

export interface GuardBreakMarker {
  x: number;
  y: number;
  stateFrame: number;
}

const ORBIT_DX = [12, 9, 0, -9, -12, -9, 0, 9] as const;
const ORBIT_DY = [0, 3, 4, 3, 0, -3, -4, -3] as const;
const SHARD_VELS: readonly (readonly [number, number])[] = [
  [-2.2, -2.6],
  [2.2, -2.6],
  [-3.0, -0.6],
  [3.0, -0.6],
  [-1.8, 1.4],
  [1.8, 1.4],
];

function drawPixelRing(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number, thickness: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(sx - r, sy - r, r * 2, thickness);
  ctx.fillRect(sx - r, sy + r - thickness, r * 2, thickness);
  ctx.fillRect(sx - r, sy - r, thickness, r * 2);
  ctx.fillRect(sx + r - thickness, sy - r, thickness, r * 2);
}

function drawChevron(ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: 1 | -1, size: number, color: string): void {
  ctx.fillStyle = color;
  for (let row = -size; row <= size; row++) {
    const px = cx + dir * (size - Math.abs(row));
    ctx.fillRect(px, cy + row, 2, 2);
  }
}

export function drawOverlay(ctx: CanvasRenderingContext2D, o: Overlay, camera: Camera): void {
  if (typeof ctx.fillRect !== "function") return;
  const sx = Math.round(o.x) - camera.x;
  const sy = Math.round(o.y) - camera.y;
  const t = o.age / Math.max(1, o.life);
  const fade = Math.max(0.15, 1 - t);

  ctx.save();
  ctx.globalAlpha = fade;
  if (!o.reduced && (o.kind === "impact_ring" || o.kind === "perfect_shield_full" || o.kind === "tech_full")) {
    ctx.globalCompositeOperation = "lighter";
  }

  switch (o.kind) {
    case "charge_smear": {
      const trail = -o.facing * (6 + o.age * 2);
      const bars = o.reduced
        ? [
            { dy: -10, len: 22, h: 2 },
            { dy: 8, len: 18, h: 2 },
          ]
        : [
            { dy: -14, len: 28, h: 4 },
            { dy: 0, len: 38, h: 3 },
            { dy: 14, len: 22, h: 2 },
          ];
      for (const b of bars) {
        const bx = o.facing === 1 ? sx + trail - b.len : sx + trail;
        ctx.fillStyle = o.color;
        ctx.fillRect(Math.round(bx), sy + b.dy, b.len, b.h);
        if (!o.reduced && o.accent) {
          const tipX = o.facing === 1 ? sx + trail - 8 : sx + trail;
          ctx.fillStyle = o.accent;
          ctx.fillRect(Math.round(tipX), sy + b.dy, 8, Math.max(1, b.h - 1));
        }
      }
      break;
    }

    case "armor_brace": {
      const span = 18;
      ctx.fillStyle = o.color;
      ctx.fillRect(sx - span, sy - 16, 2, 32);
      ctx.fillRect(sx + span - 2, sy - 16, 2, 32);
      ctx.fillRect(sx - span, sy - 16, 6, 2);
      ctx.fillRect(sx + span - 6, sy - 16, 6, 2);
      ctx.fillRect(sx - span, sy + 14, 6, 2);
      ctx.fillRect(sx + span - 6, sy + 14, 6, 2);
      break;
    }

    case "phase_collapse": {
      const gap = o.reduced ? 10 : Math.max(2, Math.round(14 * (1 - t)));
      ctx.fillStyle = o.color;
      ctx.fillRect(sx - gap, sy - 26, 2, 52);
      ctx.fillStyle = o.accent ?? o.color;
      ctx.fillRect(sx + gap - 2, sy - 26, 2, 52);
      break;
    }

    case "phase_streak": {
      const dx = o.dx ?? o.facing * 60;
      if (o.reduced) {
        for (const frac of [0.25, 0.55, 0.85]) {
          const px = sx + Math.round(dx * frac);
          ctx.fillStyle = "#0d0c22";
          ctx.fillRect(px - 3, sy - 3, 6, 6);
          ctx.fillStyle = o.color;
          ctx.fillRect(px - 2, sy - 2, 4, 4);
        }
      } else {
        const dir: 1 | -1 = dx >= 0 ? 1 : -1;
        for (let k = 0; k < 3; k++) {
          const frac = Math.min(1, t * 0.8 + k * 0.18);
          const px = sx + Math.round(dx * frac);
          ctx.fillStyle = k === 2 ? (o.accent ?? o.color) : o.color;
          ctx.fillRect(px - (dir === 1 ? 14 : 0), sy - 8 + k * 7, 14, 2);
          drawChevron(ctx, px, sy - 8 + k * 7, dir, 3, o.accent ?? o.color);
        }
      }
      break;
    }

    case "overhead_arc": {
      const steps = 6;
      for (let k = 0; k < steps; k++) {
        const progress = (k / (steps - 1)) * Math.min(1, t * 1.4 + 0.3);
        const ax = sx + o.facing * Math.round(10 + Math.sin(progress * Math.PI) * 18);
        const ay = sy + Math.round(-28 + progress * 46);
        ctx.fillStyle = k % 2 === 0 ? o.color : (o.accent ?? o.color);
        ctx.fillRect(ax - 3, ay - 2, 6, 4);
      }
      break;
    }

    case "rush_smear": {
      const trail = -o.facing * (4 + o.age * 2);
      const len = o.reduced ? 20 : 30;
      const bx = o.facing === 1 ? sx + trail - len : sx + trail;
      ctx.fillStyle = o.color;
      ctx.fillRect(Math.round(bx), sy - 2, len, 2);
      if (!o.reduced) {
        const bx2 = o.facing === 1 ? sx + trail - 20 : sx + trail;
        ctx.fillStyle = o.accent ?? "#ffffff";
        ctx.fillRect(Math.round(bx2), sy + 4, 20, 2);
      }
      break;
    }

    case "uppercut_wind": {
      if (o.reduced) {
        ctx.fillStyle = o.color;
        ctx.fillRect(sx + o.facing * 8, sy - 24, 2, 20);
      } else {
        const rise = Math.round(o.age * 4);
        const cols = [
          { dx: -8, h: 16, col: o.color },
          { dx: 2, h: 24, col: o.accent ?? o.color },
          { dx: 12, h: 14, col: o.color },
        ];
        for (const c of cols) {
          ctx.fillStyle = c.col;
          ctx.fillRect(sx + o.facing * c.dx, sy - rise - c.h, 2, c.h);
        }
      }
      break;
    }

    case "impact_ring": {
      const r = Math.round(8 + t * 18);
      drawPixelRing(ctx, sx, sy, r, 2, o.color);
      if (o.accent) drawPixelRing(ctx, sx, sy, Math.max(3, r - 4), 1, o.accent);
      break;
    }

    case "perfect_shield_full": {
      const r = Math.round(12 + o.age * 2);
      drawPixelRing(ctx, sx, sy, r, 2, o.color);
      drawPixelRing(ctx, sx, sy, Math.max(4, r - 5), 1, o.accent ?? "#ffffff");
      ctx.fillStyle = o.accent ?? "#ffffff";
      ctx.fillRect(sx - r - 5, sy - 1, 5, 2);
      ctx.fillRect(sx + r, sy - 1, 5, 2);
      ctx.fillRect(sx - 1, sy - r - 5, 2, 5);
      ctx.fillRect(sx - 1, sy + r, 2, 5);
      break;
    }

    case "perfect_shield_reduced": {
      // Steady dark-outlined cyan shield crest: clear Readability with zero strobe/expansion.
      ctx.fillStyle = o.accent ?? "#0d0c22";
      ctx.fillRect(sx - 10, sy - 13, 20, 26);
      drawPixelRing(ctx, sx, sy, 9, 2, o.color);
      ctx.fillStyle = o.color;
      ctx.fillRect(sx - 1, sy - 7, 2, 14);
      ctx.fillRect(sx - 6, sy - 1, 12, 2);
      break;
    }

    case "guard_break_full": {
      const r = Math.round(10 + o.age * 2);
      drawPixelRing(ctx, sx, sy, r, 2, o.color);
      for (const [i, vel] of SHARD_VELS.entries()) {
        const [vx, vy] = vel;
        const px = sx + Math.round(vx * o.age * 2.2);
        const py = sy + Math.round(vy * o.age * 2.2 + 0.14 * o.age * o.age);
        ctx.fillStyle = i % 2 === 0 ? o.color : (o.accent ?? o.color);
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }
      break;
    }

    case "guard_break_reduced": {
      // Split-shield glyph: two crimson halves separated by a jagged crack gap.
      ctx.fillStyle = o.accent ?? "#0d0c22";
      ctx.fillRect(sx - 13, sy - 12, 10, 24);
      ctx.fillRect(sx + 3, sy - 12, 10, 24);
      ctx.fillStyle = o.color;
      ctx.fillRect(sx - 12, sy - 11, 8, 22);
      ctx.fillRect(sx + 4, sy - 11, 8, 22);
      break;
    }

    case "tech_full": {
      const spread = Math.round(8 + o.age * 2.5);
      ctx.fillStyle = o.accent ?? "#ffffff";
      ctx.fillRect(sx - 1, sy - 14, 2, 28);
      drawChevron(ctx, sx - spread, sy, -1, 6, o.color);
      drawChevron(ctx, sx + spread, sy, 1, 6, o.color);
      drawChevron(ctx, sx - spread + 5, sy, -1, 4, o.accent ?? "#ffffff");
      drawChevron(ctx, sx + spread - 5, sy, 1, 4, o.accent ?? "#ffffff");
      break;
    }

    case "tech_reduced": {
      const spread = 12;
      ctx.fillStyle = o.accent ?? "#0d0c22";
      ctx.fillRect(sx - 2, sy - 11, 4, 22);
      ctx.fillStyle = o.color;
      ctx.fillRect(sx - 1, sy - 10, 2, 20);
      drawChevron(ctx, sx - spread, sy, -1, 5, o.color);
      drawChevron(ctx, sx + spread, sy, 1, 5, o.color);
      break;
    }
  }

  ctx.restore();
}

export function drawGuardBreakMarker(
  ctx: CanvasRenderingContext2D,
  marker: GuardBreakMarker,
  camera: Camera,
  reduced: boolean,
): void {
  if (typeof ctx.fillRect !== "function") return;
  const sx = Math.round(marker.x) - camera.x;
  const sy = Math.round(marker.y) - camera.y;
  ctx.save();
  if (reduced) {
    ctx.fillStyle = "#0d0c22";
    ctx.fillRect(sx - 4, sy - 4, 8, 8);
    ctx.fillStyle = "#ff4d6d";
    ctx.fillRect(sx - 3, sy - 3, 6, 6);
    ctx.fillStyle = "#0d0c22";
    ctx.fillRect(sx - 1, sy - 3, 2, 6);
  } else {
    const idx = Math.floor(marker.stateFrame / 4) % ORBIT_DX.length;
    const opp = (idx + 4) % ORBIT_DX.length;
    for (const [k, col] of [
      [idx, "#ff4d6d"],
      [opp, "#ffc94a"],
    ] as const) {
      const px = sx + (ORBIT_DX[k] ?? 0);
      const py = sy + (ORBIT_DY[k] ?? 0);
      ctx.fillStyle = "#0d0c22";
      ctx.fillRect(px - 3, py - 3, 6, 6);
      ctx.fillStyle = col;
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }
  }
  ctx.restore();
}
