import { Application, Graphics } from "pixi.js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type GameState = {
  totalTokens: number;
  tokenRemainder: number;
  energyBars: number;
  coins: number;
  xp: number;
  level: number;
  attackPower: number;
  wave: number;
  enemyHp: number;
  lastRefresh: string | null;
  lastError: string | null;
  connected: boolean;
  alwaysOnTop: boolean;
  muted: boolean;
};

type Phase = "idle" | "eat" | "beam" | "hit" | "victory";

const native = "__TAURI_INTERNALS__" in window;
let game: GameState = {
  totalTokens: 0,
  tokenRemainder: 0,
  energyBars: native ? 0 : 5,
  coins: 0,
  xp: 0,
  level: 1,
  attackPower: 1,
  wave: 1,
  enemyHp: 3,
  lastRefresh: null,
  lastError: null,
  connected: native,
  alwaysOnTop: true,
  muted: true,
};
let phase: Phase = "idle";
let clock = 0;
let lastWave = 1;
let audio: AudioContext | undefined;
let sceneApp: Application | undefined;

function sound(kind: "eat" | "beam" | "hit" | "victory") {
  if (game.muted) return;
  audio ??= new AudioContext();
  if (audio.state === "suspended") void audio.resume();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime;
  const tones = { eat: [420, 230, 0.09], beam: [950, 520, 0.13], hit: [190, 90, 0.12], victory: [520, 780, 0.2] } as const;
  const [start, end, duration] = tones[kind];
  oscillator.type = kind === "hit" ? "square" : "triangle";
  oscillator.frequency.setValueAtTime(start, now);
  oscillator.frequency.exponentialRampToValueAtTime(end, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.065, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

const element = (id: string) => document.getElementById(id)!;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function call(name: string): Promise<GameState> {
  if (native) return invoke<GameState>(name);
  if (name === "perform_attack" && game.energyBars > 0) {
    game.energyBars--;
    game.enemyHp = Math.max(0, game.enemyHp - game.attackPower);
    if (game.enemyHp === 0) {
      game.coins++;
      game.xp += 3;
      while (game.xp >= game.level * 10) {
        game.xp -= game.level * 10;
        game.level++;
      }
      game.wave++;
      game.enemyHp = 3 + Math.floor((game.wave - 1) / 10);
    }
  }
  if (name === "purchase_upgrade" && game.coins >= game.attackPower * 5) {
    game.coins -= game.attackPower * 5;
    game.attackPower++;
  }
  if (name === "toggle_always_on_top") game.alwaysOnTop = !game.alwaysOnTop;
  if (name === "toggle_mute") game.muted = !game.muted;
  return { ...game };
}

function showState() {
  element("energy").textContent = String(game.energyBars);
  element("coins").textContent = String(game.coins);
  element("level").textContent = String(game.level);
  element("wave").textContent = String(game.wave);
  element("tokens").textContent = game.totalTokens.toLocaleString("zh-CN");
  element("remainder").textContent = `${game.tokenRemainder} / 1000`;
  element("last-refresh").textContent = game.lastRefresh
    ? new Date(game.lastRefresh).toLocaleTimeString("zh-CN")
    : "尚未刷新";
  const status = element("source-status");
  status.textContent = game.lastError ? "读取异常" : game.connected ? "Codex 已连接" : "未发现 Codex";
  status.className = `source-status ${game.lastError ? "error" : game.connected ? "ok" : ""}`;
  const message = element("status-message");
  message.textContent = game.lastError ?? (native ? "仅在本机读取 Codex 用量记录。" : "浏览器预览：使用独立的模拟能量。" );
  message.className = game.lastError ? "error" : "";
  const upgrade = element("upgrade") as HTMLButtonElement;
  const price = game.attackPower * 5;
  upgrade.textContent = `攻击 +1 · ${price} 金币`;
  upgrade.disabled = game.coins < price;
  const pin = element("pin") as HTMLButtonElement;
  pin.textContent = game.alwaysOnTop ? "●" : "○";
  pin.title = game.alwaysOnTop ? "置顶已开启" : "置顶已关闭";
  pin.setAttribute("aria-label", pin.title);
  const soundButton = element("sound") as HTMLButtonElement;
  soundButton.textContent = game.muted ? "♪̸" : "♪";
  soundButton.title = game.muted ? "声音已关闭" : "声音已开启";
  soundButton.setAttribute("aria-label", soundButton.title);
  if (sceneApp) sceneApp.ticker.maxFPS = game.energyBars > 0 ? 30 : 8;
}

async function refresh() {
  try {
    game = await call("refresh_usage");
    showState();
  } catch (error) {
    game.lastError = String(error);
    showState();
  }
}

function drawGirl(graphics: Graphics, t: number) {
  graphics.clear();
  const bob = phase === "idle" ? Math.sin(t * 3) * 1.2 : 0;
  graphics.y = 101 + bob;
  const outline = 0x213d58;
  const coat = 0x66c9b7;
  const hair = 0x445270;
  graphics.ellipse(0, 2, 29, 5).fill({ color: 0x102638, alpha: 0.25 });
  graphics.rect(-17, -15, 10, 15).fill(outline);
  graphics.rect(6, -15, 10, 15).fill(outline);
  graphics.rect(-20, -43, 40, 31).fill(outline);
  graphics.rect(-17, -40, 34, 25).fill(coat);
  graphics.rect(-6, -38, 12, 20).fill(0xf4e8c6);
  graphics.rect(-13, -64, 28, 11).fill(hair);
  graphics.rect(-19, -60, 40, 37).fill(outline);
  graphics.rect(-16, -58, 34, 31).fill(0xf6dfbe);
  graphics.rect(-19, -59, 36, 10).fill(hair);
  graphics.rect(10, -63, 9, 13).fill(hair);
  graphics.rect(-7, -68, 5, 7).fill(hair);
  const blink = phase === "idle" && Math.sin(t * 1.5) > 0.98;
  graphics.rect(-10, -46, 4, blink ? 1 : 5).fill(outline);
  graphics.rect(7, -46, 4, blink ? 1 : 5).fill(outline);
  graphics.rect(-16, -40, 6, 3).fill(0xf6a9a0);
  graphics.rect(12, -40, 6, 3).fill(0xf6a9a0);
  if (phase === "eat") {
    graphics.rect(-1, -39, 8, 7).fill(0xb5676c);
    graphics.rect(13, -39, 13, 7).fill(outline);
    graphics.rect(16, -37, 12, 4).fill(0xffd166);
  } else {
    graphics.rect(0, -37, 6, phase === "beam" ? 2 : 3).fill(0xa75668);
  }
  if (phase === "beam" || phase === "hit" || phase === "victory") {
    graphics.rect(17, -34, 20, 7).fill(outline);
    graphics.rect(19, -32, 18, 3).fill(0xf6dfbe);
    graphics.circle(38, -30, 5).fill(phase === "beam" ? 0xffe68a : 0xf6dfbe);
  } else {
    graphics.rect(17, -37, 8, 17).fill(outline);
    graphics.rect(19, -35, 5, 14).fill(0xf6dfbe);
  }
  graphics.rect(-25, -37, 8, 17).fill(outline);
  graphics.rect(-23, -35, 5, 14).fill(0xf6dfbe);
  graphics.rect(-23, -25, 8, 10).fill(0xf5b66b);
}

function drawRobot(graphics: Graphics, t: number) {
  graphics.clear();
  graphics.y = 101 + (phase === "hit" ? Math.sin(t * 55) * 2 : Math.sin(t * 2) * 0.5);
  const edge = 0x1d354e;
  graphics.ellipse(0, 2, 25, 4).fill({ color: 0x102638, alpha: 0.25 });
  graphics.rect(-17, -18, 12, 18).fill(edge);
  graphics.rect(5, -18, 12, 18).fill(edge);
  graphics.rect(-16, -38, 32, 24).fill(edge);
  graphics.rect(-13, -35, 26, 18).fill(0x76849c);
  graphics.rect(-25, -36, 9, 21).fill(edge);
  graphics.rect(16, -36, 9, 21).fill(edge);
  graphics.rect(-28, -66, 56, 31).fill(edge);
  graphics.rect(-24, -62, 48, 23).fill(phase === "hit" ? 0xd8f9ea : 0x627ca1);
  graphics.rect(-20, -59, 40, 17).fill(phase === "hit" ? 0xe9a3ae : 0x263f5e);
  if (phase === "hit") {
    for (let index = 0; index < 5; index++) {
      graphics.rect(-16 + index * 8, -57 + (index % 2) * 7, 5, 3).fill(index % 2 ? 0xffe68a : 0x90f5df);
    }
  } else {
    graphics.rect(-11, -54, 6, 4).fill(0xf17e88);
    graphics.rect(7, -54, 6, 4).fill(0xf17e88);
    graphics.rect(-3, -47, 8, 2).fill(0xf17e88);
  }
  graphics.rect(-5, -69, 10, 3).fill(0xffbd6a);
}

async function start() {
  const app = new Application();
  await app.init({ width: 320, height: 128, backgroundAlpha: 0, antialias: false, resolution: 1, autoDensity: false });
  sceneApp = app;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) app.ticker.stop();
    else app.ticker.start();
  });
  element("playfield").appendChild(app.canvas);
  const floor = new Graphics();
  floor.rect(2, 100, 316, 8).fill(0x223d56);
  floor.rect(2, 100, 316, 2).fill(0x8dd6bc);
  floor.rect(20, 108, 280, 4).fill(0x35576b);
  app.stage.addChild(floor);
  const snack = new Graphics();
  snack.rect(91, 81, 19, 7).fill(0x25405a);
  snack.rect(93, 82, 15, 5).fill(0xffd26a);
  snack.rect(95, 83, 4, 3).fill(0xfff0c5);
  app.stage.addChild(snack);
  const girl = new Graphics();
  girl.position.set(83, 101);
  app.stage.addChild(girl);
  const robot = new Graphics();
  robot.position.set(248, 101);
  app.stage.addChild(robot);
  const beam = new Graphics();
  app.stage.addChild(beam);
  app.ticker.maxFPS = 30;
  app.ticker.add((ticker) => {
    clock += ticker.deltaTime / 60;
    drawGirl(girl, clock);
    drawRobot(robot, clock);
    beam.clear();
    if (phase === "beam") {
      beam.rect(120, 69, 102, 3).fill(0x8df9df);
      beam.rect(120, 70, 108, 1).fill(0xffffff);
      beam.circle(225, 70, 6).fill(0xffeeab);
    }
    snack.visible = game.energyBars > 0 && phase === "idle";
  });
  try { game = await call("get_game_state"); } catch (error) { game.lastError = String(error); }
  showState();
  await refresh();
  setInterval(refresh, 60_000);
  while (true) {
    if (game.energyBars === 0 || document.hidden) { await pause(600); continue; }
    phase = "eat";
    sound("eat");
    await pause(550);
    phase = "beam";
    sound("beam");
    await pause(300);
    lastWave = game.wave;
    try { game = await call("perform_attack"); showState(); } catch (error) { game.lastError = String(error); showState(); }
    phase = lastWave !== game.wave ? "victory" : "hit";
    sound(lastWave !== game.wave ? "victory" : "hit");
    await pause(lastWave !== game.wave ? 750 : 350);
    phase = "idle";
    await pause(400);
  }
}

element("drag-bar").addEventListener("pointerdown", (event) => {
  if (event.target instanceof HTMLButtonElement) return;
  if (native) invoke("begin_drag").catch(console.error);
});
element("refresh").addEventListener("click", refresh);
element("details-toggle").addEventListener("click", () => {
  const details = element("details");
  details.hidden = !details.hidden;
});
element("upgrade").addEventListener("click", async () => {
  try { game = await call("purchase_upgrade"); showState(); } catch (error) { game.lastError = String(error); showState(); }
});
element("pin").addEventListener("click", async () => {
  try { game = await call("toggle_always_on_top"); showState(); } catch (error) { game.lastError = String(error); showState(); }
});
element("sound").addEventListener("click", async () => {
  try {
    if (game.muted) {
      audio ??= new AudioContext();
      void audio.resume();
    }
    game = await call("toggle_mute");
    if (!game.muted) sound("victory");
    showState();
  } catch (error) { game.lastError = String(error); showState(); }
});

if (native) {
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  getCurrentWindow().onMoved(() => {
    if (positionTimer) clearTimeout(positionTimer);
    positionTimer = setTimeout(() => { void invoke("save_window_position").catch(console.error); }, 500);
  }).catch(console.error);
}

start().catch((error) => {
  element("status-message").textContent = String(error);
});
