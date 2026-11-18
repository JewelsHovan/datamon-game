// In-game Shield & Combat Guide ("SHIELD GUIDE" from Title and Pause menus).
// Four illustrated tabs navigated with Left/Right (or Punch to cycle, Kick/Esc
// to return), each with a live 60 Hz Canvas visual demo of the mechanic and
// dynamic key prompts reflecting both players' current bindings.
import { SHIELD } from "../data/combat";
import { BUTTON_KICK, BUTTON_LEFT, BUTTON_PUNCH, BUTTON_RIGHT, BUTTON_START } from "../input/bits";
import { keyLabel, type KeyBindings } from "../input/keymap";
import { moveLabel, text } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import type { MenuInput, Scene, SceneManager } from "./manager";
import { BOTH, DIM, drawBackdrop, drawPanel, GOLD, INK, nav, PLAYER_COLORS, pressed, type Players } from "./ui";

export const GUIDE_ITEM = "SHIELD GUIDE";
export const GUIDE_TABS = ["1. SHIELD", "2. PERFECT", "3. PUSH & AIR", "4. TECH & ROLL"] as const;
export const TOUCH_GUIDE_HINT = "LEFT / RIGHT: TOPIC   PUNCH: NEXT   KICK: BACK";

const PANEL_X = 20;
const PANEL_W = VIEW_WIDTH - PANEL_X * 2;
const CYAN = "#4ef2ff";
const AMBER = "#ffab4c";
const CORAL = "#ff4d6d";
const GREEN = "#63e294";

interface RuleRow {
  tag: string;
  tagColor: string;
  detail: string;
}

function backKeys(b: KeyBindings): string {
  return `${keyLabel(b.left[0])}/${keyLabel(b.right[0])}`;
}

function throwChord(b: KeyBindings): string {
  return `${keyLabel(b.punch[0])}+${keyLabel(b.kick[0])}`;
}

export class GuideScene implements Scene {
  readonly name = "guide" as const;
  tab = 0;

  constructor(
    private readonly m: SceneManager,
    readonly back: Scene,
    private readonly players: Players = BOTH,
  ) {}

  step(input: MenuInput): void {
    const hooks = this.m.services.hooks;
    if (input.escape || pressed(input, BUTTON_KICK, this.players)) {
      hooks.ui?.("back");
      this.m.go(this.back);
      return;
    }
    if (nav(input, BUTTON_LEFT, this.players)) {
      this.tab = (this.tab + GUIDE_TABS.length - 1) % GUIDE_TABS.length;
      hooks.ui?.("move");
    } else if (nav(input, BUTTON_RIGHT, this.players) || pressed(input, BUTTON_PUNCH | BUTTON_START, this.players)) {
      this.tab = (this.tab + 1) % GUIDE_TABS.length;
      hooks.ui?.("move");
    }
  }

  hint(): string {
    if (this.m.touchHints) return TOUCH_GUIDE_HINT;
    return `LEFT / RIGHT: TOPIC (${this.tab + 1}/${GUIDE_TABS.length})   PUNCH: NEXT   KICK OR ESC: BACK`;
  }

  describe(): string {
    return GUIDE_TABS[this.tab] ?? "1. SHIELD";
  }

  debug(): Record<string, unknown> {
    return { tab: this.tab, title: GUIDE_TABS[this.tab], tabs: [...GUIDE_TABS], hint: this.hint() };
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    drawBackdrop(ctx, frame);
    text(ctx, "SHIELD & COMBAT GUIDE", VIEW_WIDTH / 2, 10, 16, GOLD, "center");
    this.drawTabs(ctx);
    this.drawVisualDemo(ctx, frame);
    this.drawRulesCard(ctx);
    text(ctx, this.hint(), VIEW_WIDTH / 2, VIEW_HEIGHT - 20, 8, "#aeaadc", "center");
  }

  private drawTabs(ctx: CanvasRenderingContext2D): void {
    const gap = 8;
    const w = Math.floor((PANEL_W - gap * (GUIDE_TABS.length - 1)) / GUIDE_TABS.length);
    const y = 32;
    GUIDE_TABS.forEach((label, i) => {
      const x = PANEL_X + i * (w + gap);
      const active = i === this.tab;
      ctx.fillStyle = "#0d0c22";
      ctx.fillRect(x - 1, y - 1, w + 2, 18);
      ctx.fillStyle = active ? CYAN : "#2c2870";
      ctx.fillRect(x, y, w, 16);
      ctx.fillStyle = active ? "#162044" : "#141236";
      ctx.fillRect(x + 1, y + 1, w - 2, 14);
      text(ctx, label, x + w / 2, y + 4, 8, active ? CYAN : DIM, "center");
    });
  }

  private drawVisualDemo(ctx: CanvasRenderingContext2D, frame: number): void {
    const y = 54;
    const h = 74;
    drawPanel(ctx, PANEL_X, y, PANEL_W, h, "#2f4f7f");
    if (this.tab === 0) this.drawShieldGaugeDemo(ctx, PANEL_X, y, PANEL_W, h, frame);
    else if (this.tab === 1) this.drawPerfectTimingDemo(ctx, PANEL_X, y, PANEL_W, h, frame);
    else if (this.tab === 2) this.drawPushAndAirDemo(ctx, PANEL_X, y, PANEL_W, h, frame);
    else this.drawTechAndWakeupDemo(ctx, PANEL_X, y, PANEL_W, h, frame);
  }

  /** Tab 0: animated HP + Cardinal Shield bar cycling through block drain, break, and regen. */
  private drawShieldGaugeDemo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, _h: number, frame: number): void {
    const cycle = frame % 240;
    let guard: number = SHIELD.maxGuard;
    let stateLabel = "HOLD BACK TO SHIELD INCOMING STRIKES";
    let stateColor = CYAN;
    if (cycle < 50) {
      guard = 1000 - Math.floor((cycle * 420) / 50);
      stateLabel = "BLOCKING STRIKES DRAINS SHIELD INTEGRITY";
      stateColor = CYAN;
    } else if (cycle < 105) {
      guard = 580 - Math.floor(((cycle - 50) * 580) / 55);
      stateLabel = guard < 350 ? "WARNING: LOW SHIELD (<35% TURNS AMBER)" : "HEAVIES & SPECIALS DRAIN HARDER";
      stateColor = guard < 350 ? AMBER : CYAN;
    } else if (cycle < 165) {
      guard = 0;
      stateLabel = "0 SHIELD = SHIELD BREAK! (42F FREE PUNISH)";
      stateColor = CORAL;
    } else {
      guard = Math.min(1000, Math.floor(((cycle - 165) * 1000) / 70));
      stateLabel = "RELEASE BLOCK -> REGENERATES AUTOMATICALLY";
      stateColor = GREEN;
    }

    const barX = x + 22;
    const barW = 230;
    // Replica health bar
    ctx.fillStyle = "#0d0c22";
    ctx.fillRect(barX - 2, y + 14, barW + 4, 14);
    ctx.fillStyle = GOLD;
    ctx.fillRect(barX, y + 16, barW, 10);
    text(ctx, "HP", barX - 4, y + 17, 8, INK, "right");

    // Replica Cardinal Shield bar underneath
    const sy = y + 34;
    const sw = 160;
    ctx.fillStyle = "#0d0c22";
    ctx.fillRect(barX - 1, sy - 1, sw + 2, 8);
    ctx.fillStyle = "#19183e";
    ctx.fillRect(barX, sy, sw, 6);
    const fillW = Math.round((sw * guard) / SHIELD.maxGuard);
    ctx.fillStyle = guard === 0 ? CORAL : guard < 350 ? AMBER : CYAN;
    if (fillW > 0) ctx.fillRect(barX, sy, fillW, 6);
    else if (Math.floor(frame / 6) % 2 === 0) ctx.fillRect(barX, sy, sw, 6);
    text(ctx, `SHIELD ${Math.round(guard / 10)}%`, barX + sw + 10, sy - 1, 8, stateColor, "left");

    // Right side status callout
    if (guard === 0 && Math.floor(frame / 8) % 2 === 0) {
      text(ctx, "SHIELD BREAK!", x + w - 125, y + 16, 16, CORAL, "center");
    } else {
      text(ctx, "NO EXTRA BUTTON!", x + w - 125, y + 18, 8, GOLD, "center");
    }
    text(ctx, stateLabel, x + w / 2, y + 54, 8, stateColor, "center");
  }

  /** Tab 1: animated 3-frame Perfect Shield timing lane. */
  private drawPerfectTimingDemo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, _h: number, frame: number): void {
    const trackX = x + 36;
    const trackW = w - 72;
    const trackY = y + 24;
    const zoneW = 34;
    const zoneX = trackX + trackW - zoneW - 24;

    ctx.fillStyle = "#141236";
    ctx.fillRect(trackX, trackY, trackW, 12);
    // Normal block zone (dim blue) vs 3-frame Perfect zone (bright cyan)
    ctx.fillStyle = "#2b3f78";
    ctx.fillRect(zoneX - 58, trackY, 58, 12);
    ctx.fillStyle = CYAN;
    ctx.fillRect(zoneX, trackY - 2, zoneW, 16);

    const t = (frame % 90) / 90;
    const orbX = Math.round(trackX + t * (zoneX + zoneW / 2 - trackX));
    const inPerfect = orbX >= zoneX - 2;
    ctx.fillStyle = inPerfect ? "#ffffff" : "#ff6170";
    ctx.fillRect(orbX - 6, trackY - 1, 12, 14);

    text(ctx, "HOLD EARLY = NORMAL", zoneX - 64, y + 8, 8, DIM, "right");
    text(ctx, "3F TAP!", zoneX + zoneW / 2, y + 8, 8, CYAN, "center");
    if (inPerfect) {
      text(ctx, "PERFECT SHIELD!  0 CHIP  +16% SHIELD  -5F STUN", x + w / 2, y + 50, 8, CYAN, "center");
    } else {
      text(ctx, "TAP BACK JUST BEFORE IMPACT FOR INSTANT COUNTER-TURN", x + w / 2, y + 50, 8, INK, "center");
    }
  }

  /** Tab 2: Pushblock & Air Shield split diagram. */
  private drawPushAndAirDemo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frame: number): void {
    const mid = x + Math.floor(w / 2);
    ctx.fillStyle = "#2f4f7f";
    ctx.fillRect(mid, y + 8, 1, h - 16);

    const shove = Math.min(42, (frame % 60) * 2);
    text(ctx, "PUSHBLOCK (GROUND)", x + w / 4, y + 10, 8, GOLD, "center");
    ctx.fillStyle = PLAYER_COLORS[0];
    ctx.fillRect(x + 76, y + 26, 14, 22);
    ctx.fillStyle = CYAN;
    ctx.fillRect(x + 93, y + 24, 4, 26);
    ctx.fillStyle = PLAYER_COLORS[1];
    ctx.fillRect(x + 110 + shove, y + 26, 14, 22);
    text(ctx, "-22% SHIELD -> BIG SPACE", x + w / 4, y + 54, 8, CYAN, "center");

    text(ctx, "AIR SHIELD (JUMPING)", mid + w / 4, y + 10, 8, GOLD, "center");
    text(ctx, "BLOCKS: ORBS & AIR HITS", mid + w / 4, y + 28, 8, GREEN, "center");
    text(ctx, "LOSES TO: GROUND ANTI-AIR", mid + w / 4, y + 44, 8, CORAL, "center");
  }

  /** Tab 3: Throw Escape, 3-Way Wakeup & Counter-Hit summary banner. */
  private drawTechAndWakeupDemo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, _h: number, frame: number): void {
    const flash = Math.floor(frame / 20) % 3;
    const badges = [
      { label: "THROW TECH (8F)", sub: "PUNCH+KICK BREAKS GRAB", color: CYAN },
      { label: "3-WAY WAKEUP", sub: "BACK / FWD ROLL / UP RISE", color: GREEN },
      { label: "COUNTER! (+3F)", sub: "HIT STARTUP -> EXTRA LINK", color: GOLD },
    ];
    const colW = Math.floor((w - 24) / 3);
    badges.forEach((b, i) => {
      const cx = x + 12 + colW * i + colW / 2;
      const hi = flash === i;
      text(ctx, b.label, cx, y + 16, 8, hi ? "#ffffff" : b.color, "center");
      text(ctx, b.sub, cx, y + 36, 8, hi ? b.color : DIM, "center");
    });
    text(ctx, "THROWS BEAT SHIELD  -  COMMAND GRABS CANNOT BE TECHED!", x + w / 2, y + 54, 8, CORAL, "center");
  }

  private drawRulesCard(ctx: CanvasRenderingContext2D): void {
    const y = 134;
    const h = 190;
    drawPanel(ctx, PANEL_X, y, PANEL_W, h);

    const [b1, b2] = this.m.services.bindings.current;
    const p1Pad = this.m.services.hasPad(0);
    const p2Pad = this.m.services.hasPad(1);
    const p1Line = this.bindingSummary(b1, p1Pad, "P1");
    const p2Line = this.bindingSummary(b2, p2Pad, "P2");
    text(ctx, p1Line, PANEL_X + 14, y + 10, 8, PLAYER_COLORS[0], "left");
    text(ctx, p2Line, PANEL_X + PANEL_W - 14, y + 10, 8, PLAYER_COLORS[1], "right");

    ctx.fillStyle = "#2c2870";
    ctx.fillRect(PANEL_X + 12, y + 24, PANEL_W - 24, 1);

    const rows = this.rowsForTab();
    rows.forEach((r, idx) => {
      const ry = y + 32 + idx * 38;
      text(ctx, r.tag, PANEL_X + 14, ry, 8, r.tagColor, "left");
      text(ctx, r.detail, PANEL_X + 14, ry + 14, 8, INK, "left");
    });
  }

  private bindingSummary(b: KeyBindings, pad: boolean, who: string): string {
    if (pad) {
      if (this.tab <= 1) return `${who} PAD: BACK=SHIELD  D+BACK=LOW`;
      return `${who} PAD: A+B=PUSH/TECH  D-PAD=ROLL`;
    }
    if (this.tab <= 1) return `${who}: ${backKeys(b)} SHIELD  ${keyLabel(b.down[0])}+BACK LOW`;
    return `${who}: ${throwChord(b)} PUSH/TECH  ${moveLabel(b)} ROLL`;
  }

  private rowsForTab(): RuleRow[] {
    if (this.tab === 0) {
      return [
        {
          tag: "STANDING SHIELD  (HOLD AWAY FROM FOE)",
          tagColor: CYAN,
          detail: "STOPS MID & OVERHEAD HITS. SPECIALS DEAL SMALL CHIP.",
        },
        {
          tag: "CROUCH SHIELD  (HOLD DOWN + AWAY)",
          tagColor: CYAN,
          detail: "STOPS LOW SWEEPS & MIDS. LOSES TO JUMP-INS & OVERHEADS.",
        },
        {
          tag: "SHIELD INTEGRITY & REGEN",
          tagColor: AMBER,
          detail: "BLOCKING DRAINS YOUR CYAN BAR; RELEASING GUARD REFILLS IT.",
        },
        {
          tag: "SHIELD BREAK  (0% INTEGRITY)",
          tagColor: CORAL,
          detail: "SHATTERS INTO A 42F DIZZY STAGGER -> REFILLS AFTER PUNISH.",
        },
      ];
    }
    if (this.tab === 1) {
      return [
        {
          tag: "HOW TO PERFECT SHIELD  (3-FRAME WINDOW)",
          tagColor: CYAN,
          detail: "TAP BACK WITHIN 3 FRAMES BEFORE AN ATTACK OR ORB LANDS.",
        },
        {
          tag: "REWARD 1: ZERO CHIP & +16% SHIELD",
          tagColor: GREEN,
          detail: "NEGATES ALL SPECIAL CHIP DAMAGE AND REBUILDS YOUR BAR.",
        },
        {
          tag: "REWARD 2: -5F BLOCKSTUN & LESS FREEZE",
          tagColor: GOLD,
          detail: "YOU RECOVER FIRST TO PUNISH UNSAFE STRINGS IMMEDIATELY.",
        },
        {
          tag: "ANTI-SPAM RULE",
          tagColor: AMBER,
          detail: "HOLDING BACK EARLY GIVES NORMAL SHIELD; RE-TAP FOR PARRY.",
        },
      ];
    }
    if (this.tab === 2) {
      return [
        {
          tag: "PUSHBLOCK  (PUNCH + KICK WHILE BLOCKING)",
          tagColor: GOLD,
          detail: "SHOVES THE ATTACKER FAR BACK TO RESET NEUTRAL SPACE.",
        },
        {
          tag: "PUSHBLOCK COST  (22% SHIELD)",
          tagColor: AMBER,
          detail: "NEEDS >=22% SHIELD. OVERUSING IT RISKS A SHIELD BREAK!",
        },
        {
          tag: "AIR SHIELD  (HOLD BACK IN MID-AIR)",
          tagColor: CYAN,
          detail: "BLOCKS PROJECTILES & AIR-TO-AIR HITS AT 1.5X SHIELD COST.",
        },
        {
          tag: "ANTI-AIR RULE  (GROUND BEATS AIR SHIELD)",
          tagColor: CORAL,
          detail: "GROUNDED UPPERCUTS & NORMALS PIERCE AIR SHIELD CLEANLY!",
        },
      ];
    }
    return [
      {
        tag: "THROW & 8-FRAME THROW ESCAPE  (PUNCH + KICK)",
        tagColor: CYAN,
        detail: "THROWS BEAT SHIELD! PRESS PUNCH+KICK IN 8F TO TECH OUT.",
      },
      {
        tag: "COMMAND GRABS  (GRAPPLER F+SPECIAL)",
        tagColor: CORAL,
        detail: "UNBLOCKABLE & UNTECHABLE! JUMP OR BACKDASH TO PUNISH.",
      },
      {
        tag: "3-WAY WAKEUP  (WHILE KNOCKED DOWN)",
        tagColor: GREEN,
        detail: "HOLD BACK/FWD TO ROLL (LAST 5F VULNERABLE) OR UP TO RISE.",
      },
      {
        tag: "COUNTER! (+3F STUN) & PUNISH!",
        tagColor: GOLD,
        detail: "STUFF STARTUP FOR +3F COMBO LINKS; HIT WHIFFS FOR PUNISH!",
      },
    ];
  }
}
