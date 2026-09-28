import { Application, Graphics, Text } from "pixi.js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import gameConfig from "../game-config.json";

const { rules, timing, display, preview } = gameConfig;

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

type Phase = "idle" | "take" | "eat" | "beam" | "hit" | "victory";
type EnemyMode = "entering" | "ready" | "defeated";

const enemyFightX = 248;
const enemySpawnX = 350;
const enemyHpForWave = (wave: number) => rules.enemyBaseHp + Math.floor((wave - 1) / rules.enemyHpEveryWaves);

const native = "__TAURI_INTERNALS__" in window;
let game: GameState = {
  totalTokens: 0,
  tokenRemainder: 0,
  energyBars: native ? 0 : preview.startingBars,
  coins: 0,
  xp: 0,
  level: rules.startingLevel,
  attackPower: rules.startingAttackPower,
  wave: rules.startingWave,
  enemyHp: enemyHpForWave(rules.startingWave),
  lastRefresh: null,
  lastError: null,
  connected: native,
  alwaysOnTop: true,
  muted: true,
};
let phase: Phase = "idle";
let clock = 0;
let enemyMode: EnemyMode = "entering";
let enemyX = enemySpawnX;
let audio: AudioContext | undefined;
let sceneApp: Application | undefined;
let productionQueue: number[] = [];
let activeProduction: number | null = null;
let productionProgress = 0;
let pendingBars = 0;
let reservedBar = false;
let takeProgress = 0;
let refreshing = false;
let nativeCallQueue: Promise<void> = Promise.resolve();

function updateFrameRate() {
  if (sceneApp) sceneApp.ticker.maxFPS = game.energyBars > 0 || enemyMode === "entering" || activeProduction !== null || productionQueue.length > 0 ? timing.activeFps : timing.idleFps;
}

function pileCount() {
  return Math.max(0, game.energyBars - pendingBars - Number(reservedBar));
}

function queueProduction(tokens: number, bars: number) {
  if (tokens <= 0) return;
  pendingBars += bars;
  if (bars === 0) productionQueue.push(0);
  else {
    const separate = Math.min(bars, display.individualBarsPerRefresh);
    for (let index = 0; index < separate; index++) productionQueue.push(1);
    if (bars > separate) productionQueue.push(bars - separate);
  }
  updateFrameRate();
}

function advanceProduction(milliseconds: number) {
  if (activeProduction === null && productionQueue.length > 0) {
    activeProduction = productionQueue.shift()!;
    productionProgress = 0;
  }
  if (activeProduction === null) return;
  productionProgress += milliseconds / timing.productionBatchMs;
  if (productionProgress >= 1) {
    pendingBars -= activeProduction;
    activeProduction = null;
    productionProgress = 0;
    updateFrameRate();
  }
}

function setEnemyMode(mode: EnemyMode) {
  enemyMode = mode;
  updateFrameRate();
}

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
  if (native) {
    const next = nativeCallQueue.then(() => invoke<GameState>(name));
    nativeCallQueue = next.then(() => undefined, () => undefined);
    return next;
  }
  if (name === "perform_attack" && game.energyBars > 0) {
    game.energyBars--;
    game.enemyHp = Math.max(0, game.enemyHp - game.attackPower);
    if (game.enemyHp === 0) {
      game.coins += rules.coinsPerDefeat;
      game.xp += rules.xpPerDefeat;
      while (game.xp >= game.level * rules.xpPerLevel) {
        game.xp -= game.level * rules.xpPerLevel;
        game.level++;
      }
      game.wave++;
      game.enemyHp = enemyHpForWave(game.wave);
    }
  }
  if (name === "purchase_upgrade" && game.coins >= game.attackPower * rules.upgradeCostPerAttackPower) {
    game.coins -= game.attackPower * rules.upgradeCostPerAttackPower;
    game.attackPower += rules.attackPowerPerUpgrade;
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
  element("remainder").textContent = `${game.tokenRemainder} / ${rules.tokensPerBar}`;
  element("last-refresh").textContent = game.lastRefresh
    ? new Date(game.lastRefresh).toLocaleTimeString("zh-CN")
    : "尚未刷新";
  const status = element("source-status");
  status.textContent = !native ? "模拟模式" : game.lastError ? "读取异常" : game.connected ? "Codex 已连接" : "未发现 Codex";
  status.className = `source-status ${!native ? "" : game.lastError ? "error" : game.connected ? "ok" : ""}`;
  const message = element("status-message");
  message.textContent = game.lastError ?? (native ? "仅在本机读取 Codex 用量记录。" : "浏览器预览：使用独立的模拟能量。" );
  message.className = game.lastError ? "error" : "";
  const upgrade = element("upgrade") as HTMLButtonElement;
  const price = game.attackPower * rules.upgradeCostPerAttackPower;
  upgrade.textContent = `攻击 +${rules.attackPowerPerUpgrade} · ${price} 金币`;
  upgrade.disabled = game.coins < price;
  const pin = element("pin") as HTMLButtonElement;
  pin.textContent = game.alwaysOnTop ? "●" : "○";
  pin.title = game.alwaysOnTop ? "置顶已开启" : "置顶已关闭";
  pin.setAttribute("aria-label", pin.title);
  const soundButton = element("sound") as HTMLButtonElement;
  soundButton.textContent = game.muted ? "♪̸" : "♪";
  soundButton.title = game.muted ? "声音已关闭" : "声音已开启";
  soundButton.setAttribute("aria-label", soundButton.title);
  updateFrameRate();
}

async function refresh(simulate = true) {
  if (refreshing) return;
  refreshing = true;
  (element("refresh") as HTMLButtonElement).disabled = true;
  try {
    const oldTokens = game.totalTokens;
    const oldRemainder = game.tokenRemainder;
    if (!native && simulate) {
      const tokens = preview.tokensPerRefresh;
      game.totalTokens += tokens;
      game.energyBars += Math.floor((oldRemainder + tokens) / rules.tokensPerBar);
      game.tokenRemainder = (oldRemainder + tokens) % rules.tokensPerBar;
      game.lastRefresh = new Date().toISOString();
    } else if (native) game = await call("refresh_usage");
    const newTokens = Math.max(0, game.totalTokens - oldTokens);
    queueProduction(newTokens, Math.floor((oldRemainder + newTokens) / rules.tokensPerBar));
    showState();
  } catch (error) {
    game.lastError = String(error);
    showState();
  } finally {
    refreshing = false;
    (element("refresh") as HTMLButtonElement).disabled = false;
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
  if (phase === "take") {
    graphics.rect(-43, -39, 24, 8).fill(outline);
    graphics.rect(-44, -37, 21, 4).fill(0xf6dfbe);
    graphics.circle(-44, -35, 4).fill(0xf6dfbe);
  } else if (phase === "eat") {
    graphics.rect(-24, -42, 20, 8).fill(outline);
    graphics.rect(-22, -40, 18, 4).fill(0xf6dfbe);
  } else {
    graphics.rect(-25, -37, 8, 17).fill(outline);
    graphics.rect(-23, -35, 5, 14).fill(0xf6dfbe);
  }
  graphics.rect(-23, -25, 8, 10).fill(0xf5b66b);
}

function drawBar(graphics: Graphics, x: number, y: number) {
  graphics.rect(x, y, 17, 7).fill(0x25405a);
  graphics.rect(x + 2, y + 1, 13, 5).fill(0xffd26a);
  graphics.rect(x + 4, y + 2, 4, 3).fill(0xfff0c5);
  graphics.rect(x + 13, y + 1, 2, 5).fill(0xf19d69);
}

function drawMachine(graphics: Graphics, t: number) {
  graphics.clear();
  const running = activeProduction !== null;
  graphics.rect(0, 55, 19, 13).fill(0x243c52);
  graphics.rect(0, 58, 18, 6).fill(0x75b5b3);
  graphics.rect(11, 42, 45, 58).fill(0x21394f);
  graphics.rect(14, 45, 39, 52).fill(0x5d8290);
  graphics.rect(17, 48, 33, 20).fill(0x203a50);
  graphics.rect(20, 51, 27, 14).fill(running ? 0x62d0bd : 0x3d6573);
  graphics.rect(25, 55, 4, 7).fill(0x163448);
  graphics.rect(29, 55, 4, 2).fill(0x163448);
  graphics.rect(35, 55, 4, 7).fill(0x163448);
  graphics.rect(33, 60, 6, 2).fill(0x163448);
  graphics.rect(17, 73, 30, 15).fill(0x2f5264);
  if (game.tokenRemainder > 0) graphics.rect(20, 76, Math.max(1, Math.floor(24 * game.tokenRemainder / rules.tokensPerBar)), 5).fill(0xffd36b);
  graphics.rect(19, 90, 7, 7).fill(0x21394f);
  graphics.rect(41, 90, 7, 7).fill(0x21394f);
  graphics.rect(51, 75, 15, 10).fill(0x21394f);
  graphics.rect(54, 77, 12, 6).fill(0xabc8bd);
  const light = running && Math.sin(t * 24) > 0 ? 0xffe488 : 0x8babb0;
  graphics.circle(47, 71, 2).fill(light);
  if (running && productionProgress < 0.5) {
    const x = Math.round(-4 + productionProgress * 58);
    graphics.rect(x, 58, 5, 5).fill(0xa0f9e1);
    graphics.rect(x + 1, 59, 3, 3).fill(0xeaffcf);
  }
}

function drawPile(graphics: Graphics) {
  graphics.clear();
  graphics.rect(64, 95, 38, 5).fill(0x263e54);
  graphics.rect(66, 95, 34, 2).fill(0x8bb5a9);
  const bars = Math.min(pileCount(), display.maxPileBars);
  for (let index = 0; index < bars; index++) {
    const row = Math.floor(index / 3);
    const column = index % 3;
    drawBar(graphics, 65 + column * 11 + (row % 2 ? 4 : 0), 88 - row * 7);
  }
}

function drawMovingBars(graphics: Graphics) {
  graphics.clear();
  if (activeProduction !== null && activeProduction > 0 && productionProgress >= 0.5) {
    const progress = (productionProgress - 0.5) * 2;
    drawBar(graphics, Math.round(54 + progress * 20), Math.round(76 + progress * 8));
  }
  if (phase === "take") {
    const eased = takeProgress * takeProgress * (3 - 2 * takeProgress);
    drawBar(graphics, Math.round(78 + eased * 43), Math.round(79 - eased * 17));
  } else if (phase === "eat") drawBar(graphics, 121, 62);
}

function drawRobot(graphics: Graphics, t: number) {
  graphics.clear();
  const walking = enemyMode === "entering";
  const stride = walking ? Math.round(Math.sin(t * 16) * 3) : 0;
  graphics.x = Math.round(enemyX);
  graphics.y = 101 + (phase === "hit" ? Math.sin(t * 55) * 2 : walking ? Math.abs(stride) * 0.4 : Math.sin(t * 2) * 0.5);
  graphics.alpha = enemyMode === "defeated" ? 0.55 : 1;
  graphics.scale.y = enemyMode === "defeated" ? 0.75 : 1;
  const edge = 0x1d354e;
  graphics.ellipse(0, 2, 25, 4).fill({ color: 0x102638, alpha: 0.25 });
  graphics.rect(-17 + stride, -18, 12, 18).fill(edge);
  graphics.rect(5 - stride, -18, 12, 18).fill(edge);
  graphics.rect(-16, -38, 32, 24).fill(edge);
  graphics.rect(-13, -35, 26, 18).fill(0x76849c);
  graphics.rect(-25, -36, 9, 21).fill(edge);
  graphics.rect(16, -36, 9, 21).fill(edge);
  graphics.rect(-28, -66, 56, 31).fill(edge);
  graphics.rect(-24, -62, 48, 23).fill(phase === "hit" ? 0xd8f9ea : 0x627ca1);
  graphics.rect(-20, -59, 40, 17).fill(enemyMode === "defeated" ? 0x172b3d : phase === "hit" ? 0xe9a3ae : 0x263f5e);
  if (enemyMode === "defeated") {
    graphics.rect(-12, -51, 24, 2).fill(0x6b8791);
  } else if (phase === "hit") {
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
  const machine = new Graphics();
  app.stage.addChild(machine);
  const machineLabel = new Text({ text: "TOKEN", style: { fontFamily: "monospace", fontSize: 7, fontWeight: "bold", fill: 0xa0f9e1 } });
  machineLabel.position.set(3, 33);
  app.stage.addChild(machineLabel);
  const pile = new Graphics();
  app.stage.addChild(pile);
  const girl = new Graphics();
  girl.position.set(129, 101);
  app.stage.addChild(girl);
  const robot = new Graphics();
  robot.position.set(enemySpawnX, 101);
  app.stage.addChild(robot);
  const beam = new Graphics();
  app.stage.addChild(beam);
  const movingBars = new Graphics();
  app.stage.addChild(movingBars);
  app.ticker.maxFPS = timing.activeFps;
  app.ticker.add((ticker) => {
    clock += ticker.deltaTime / 60;
    advanceProduction(ticker.deltaMS);
    if (phase === "take") takeProgress = Math.min(1, takeProgress + ticker.deltaMS / timing.takeMs);
    if (enemyMode === "entering") {
      enemyX = Math.max(enemyFightX, enemyX - timing.enemyWalkPixelsPerSecond * ticker.deltaMS / 1000);
      if (enemyX === enemyFightX) setEnemyMode("ready");
    }
    drawMachine(machine, clock);
    drawPile(pile);
    drawGirl(girl, clock);
    drawRobot(robot, clock);
    drawMovingBars(movingBars);
    beam.clear();
    if (phase === "beam") {
      beam.rect(166, 69, 56, 3).fill(0x8df9df);
      beam.rect(166, 70, 62, 1).fill(0xffffff);
      beam.circle(225, 70, 6).fill(0xffeeab);
    }
  });
  try { game = await call("get_game_state"); } catch (error) { game.lastError = String(error); }
  showState();
  await refresh(false);
  if (native) setInterval(() => { void refresh(); }, timing.usageRefreshMs);
  while (true) {
    if (document.hidden) { await pause(600); continue; }
    if (enemyMode !== "ready") { await pause(100); continue; }
    if (pileCount() === 0) { await pause(100); continue; }
    reservedBar = true;
    takeProgress = 0;
    phase = "take";
    await pause(timing.takeMs);
    phase = "eat";
    sound("eat");
    await pause(timing.eatMs);
    phase = "beam";
    sound("beam");
    await pause(timing.beamMs);
    const waveBefore = game.wave;
    try { game = await call("perform_attack"); reservedBar = false; showState(); }
    catch (error) { reservedBar = false; game.lastError = String(error); showState(); phase = "idle"; await pause(600); continue; }
    const defeated = waveBefore !== game.wave;
    if (defeated) setEnemyMode("defeated");
    phase = defeated ? "victory" : "hit";
    sound(defeated ? "victory" : "hit");
    await pause(defeated ? timing.defeatMs : timing.hitMs);
    phase = "idle";
    if (defeated) {
      enemyX = enemySpawnX;
      setEnemyMode("entering");
      continue;
    }
    await pause(timing.retryAfterHitMs);
  }
}

element("playfield").addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (native) invoke("begin_drag").catch(console.error);
});
element("refresh").addEventListener("click", () => { void refresh(); });
element("details-toggle").addEventListener("click", () => {
  const details = element("details");
  details.hidden = !details.hidden;
  const toggle = element("details-toggle") as HTMLButtonElement;
  toggle.textContent = details.hidden ? "⌃" : "⌄";
  toggle.title = details.hidden ? "展开数据状态" : "收起数据状态";
  toggle.setAttribute("aria-label", toggle.title);
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
element("minimize").addEventListener("click", async () => {
  if (!native) return;
  try {
    await invoke("save_window_position");
    await invoke("minimize_window");
  } catch (error) { game.lastError = String(error); showState(); }
});
element("close").addEventListener("click", async () => {
  if (!native) return;
  try { await invoke("save_window_position"); } catch (error) { console.error(error); }
  void invoke("quit_app").catch(console.error);
});

if (native) {
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  getCurrentWindow().onMoved(() => {
    if (positionTimer) clearTimeout(positionTimer);
    positionTimer = setTimeout(() => { void invoke("save_window_position").catch(console.error); }, 500);
  }).catch(console.error);
} else {
  (element("minimize") as HTMLButtonElement).disabled = true;
  (element("close") as HTMLButtonElement).disabled = true;
}

start().catch((error) => {
  element("status-message").textContent = String(error);
});
