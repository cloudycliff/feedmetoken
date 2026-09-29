import { Application, Graphics, Sprite, Text } from "pixi.js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import gameConfig from "../game-config.json";
import { animationFrame, loadSkin, loadSkinCatalog, type LoadedSkin } from "./skins";

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
  skinId: string;
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
  skinId: "mint",
};
let phase: Phase = "idle";
let phaseElapsedMs = 0;
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
let skinError: string | null = null;
let nativeCallQueue: Promise<void> = Promise.resolve();

function setPhase(next: Phase) {
  phase = next;
  phaseElapsedMs = 0;
}

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

async function call(name: string, args: Record<string, unknown> = {}): Promise<GameState> {
  if (native) {
    const next = nativeCallQueue.then(() => invoke<GameState>(name, args));
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
  if (name === "set_skin") {
    game.skinId = String(args.skinId);
    localStorage.setItem("feed-me-token-skin", game.skinId);
  }
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
  message.textContent = skinError ?? game.lastError ?? (native ? "仅在本机读取 Codex 用量记录。" : "浏览器预览：使用独立的模拟能量。" );
  message.className = skinError || game.lastError ? "error" : "";
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

async function start() {
  const app = new Application();
  await app.init({ width: 320, height: 128, backgroundAlpha: 0, antialias: false, resolution: 1, autoDensity: false });
  sceneApp = app;
  try { game = await call("get_game_state"); } catch (error) { game.lastError = String(error); }
  const catalog = await loadSkinCatalog();
  const selectedId = native ? game.skinId : localStorage.getItem("feed-me-token-skin") ?? game.skinId;
  let skin: LoadedSkin;
  try {
    skin = await loadSkin(catalog, selectedId);
  } catch (error) {
    skinError = `已使用默认皮肤：${String(error)}`;
    skin = await loadSkin(catalog, catalog.defaultSkin);
    try { game = await call("set_skin", { skinId: catalog.defaultSkin }); }
    catch (saveError) { skinError += `；保存选择失败：${String(saveError)}`; }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) app.ticker.stop();
    else app.ticker.start();
  });
  element("playfield").appendChild(app.canvas);
  const floor = new Sprite(skin.textures[skin.manifest.objects.floor]);
  floor.position.set(0, 100);
  app.stage.addChild(floor);
  const machine = new Sprite(animationFrame(skin, "machine", "idle", 0));
  machine.position.set(0, 42);
  app.stage.addChild(machine);
  const machineFx = new Graphics();
  app.stage.addChild(machineFx);
  const machineLabel = new Text({ text: "TOKEN", style: { fontFamily: "monospace", fontSize: 7, fontWeight: "bold", fill: 0xa0f9e1 } });
  machineLabel.position.set(3, 33);
  app.stage.addChild(machineLabel);
  const tray = new Sprite(skin.textures[skin.manifest.objects.tray]);
  tray.position.set(64, 95);
  app.stage.addChild(tray);
  const pileBars = Array.from({ length: display.maxPileBars }, () => new Sprite(skin.textures[skin.manifest.objects.bar]));
  for (const bar of pileBars) app.stage.addChild(bar);
  const girl = new Sprite(animationFrame(skin, "girl", "idle", 0));
  girl.position.set(129, 101);
  app.stage.addChild(girl);
  const robot = new Sprite(animationFrame(skin, "robot", "entering", 0));
  robot.position.set(enemySpawnX, 101);
  app.stage.addChild(robot);
  const beam = new Graphics();
  app.stage.addChild(beam);
  const producedBar = new Sprite(skin.textures[skin.manifest.objects.bar]);
  const takenBar = new Sprite(skin.textures[skin.manifest.objects.bar]);
  app.stage.addChild(producedBar, takenBar);
  const skinSelect = element("skin-select") as HTMLSelectElement;
  for (const item of catalog.skins) skinSelect.add(new Option(item.name, item.id));
  skinSelect.value = skin.manifest.id;

  function applySkin(next: LoadedSkin) {
    skin = next;
    floor.texture = skin.textures[skin.manifest.objects.floor];
    tray.texture = skin.textures[skin.manifest.objects.tray];
    machine.texture = animationFrame(skin, "machine", "idle", 0);
    girl.texture = animationFrame(skin, "girl", "idle", 0);
    robot.texture = animationFrame(skin, "robot", "ready", 0);
    const [girlX, girlY] = skin.manifest.anchors.girl;
    const [robotX, robotY] = skin.manifest.anchors.robot;
    girl.anchor.set(girlX / girl.texture.width, girlY / girl.texture.height);
    robot.anchor.set(robotX / robot.texture.width, robotY / robot.texture.height);
    for (const bar of [...pileBars, producedBar, takenBar]) bar.texture = skin.textures[skin.manifest.objects.bar];
    machineLabel.style.fill = skin.colors.token;
  }
  applySkin(skin);
  skinSelect.addEventListener("change", async () => {
    const nextId = skinSelect.value;
    skinSelect.disabled = true;
    try {
      const next = await loadSkin(catalog, nextId);
      game = await call("set_skin", { skinId: nextId });
      applySkin(next);
      skinError = null;
    } catch (error) {
      skinSelect.value = skin.manifest.id;
      skinError = `切换皮肤失败：${String(error)}`;
    } finally {
      skinSelect.disabled = false;
      showState();
    }
  });
  app.ticker.maxFPS = timing.activeFps;
  app.ticker.add((ticker) => {
    clock += ticker.deltaTime / 60;
    phaseElapsedMs += ticker.deltaMS;
    advanceProduction(ticker.deltaMS);
    if (phase === "take") takeProgress = Math.min(1, takeProgress + ticker.deltaMS / timing.takeMs);
    if (enemyMode === "entering") {
      enemyX = Math.max(enemyFightX, enemyX - timing.enemyWalkPixelsPerSecond * ticker.deltaMS / 1000);
      if (enemyX === enemyFightX) setEnemyMode("ready");
    }
    machine.texture = animationFrame(skin, "machine", activeProduction === null ? "idle" : "active", clock);
    machineFx.clear();
    if (game.tokenRemainder > 0) {
      machineFx.rect(20, 76, Math.max(1, Math.floor(24 * game.tokenRemainder / rules.tokensPerBar)), 5).fill(skin.colors.progress);
    }
    if (activeProduction !== null && productionProgress < 0.5) {
      const x = Math.round(-4 + productionProgress * 58);
      machineFx.rect(x, 58, 5, 5).fill(skin.colors.token);
      machineFx.rect(x + 1, 59, 3, 3).fill(0xeaffcf);
    }
    const bars = Math.min(pileCount(), display.maxPileBars);
    pileBars.forEach((bar, index) => {
      bar.visible = index < bars;
      if (!bar.visible) return;
      const row = Math.floor(index / 3);
      const column = index % 3;
      bar.position.set(65 + column * 11 + (row % 2 ? 4 : 0), 88 - row * 7);
    });
    girl.texture = animationFrame(skin, "girl", phase, phaseElapsedMs / 1000, phase === "idle");
    girl.y = 101 + (phase === "idle" ? Math.sin(clock * 3) * 1.2 : 0);
    robot.texture = animationFrame(skin, "robot", enemyMode === "defeated" ? "defeated" : phase === "hit" ? "hit" : enemyMode, clock);
    const stride = enemyMode === "entering" ? Math.round(Math.sin(clock * 16) * 3) : 0;
    robot.position.set(Math.round(enemyX), 101 + (phase === "hit" ? Math.sin(clock * 55) * 2 : enemyMode === "entering" ? Math.abs(stride) * 0.4 : Math.sin(clock * 2) * 0.5));
    robot.alpha = enemyMode === "defeated" ? 0.55 : 1;
    robot.scale.y = enemyMode === "defeated" ? 0.75 : 1;
    producedBar.visible = activeProduction !== null && activeProduction > 0 && productionProgress >= 0.5;
    if (producedBar.visible) {
      const progress = (productionProgress - 0.5) * 2;
      producedBar.position.set(Math.round(54 + progress * 20), Math.round(76 + progress * 8));
    }
    takenBar.visible = phase === "take" || (phase === "eat" && phaseElapsedMs < timing.eatMs / 2);
    if (phase === "take") {
      const eased = takeProgress * takeProgress * (3 - 2 * takeProgress);
      takenBar.position.set(Math.round(78 + eased * 43), Math.round(79 - eased * 17));
    } else if (phase === "eat") takenBar.position.set(121, 62);
    beam.clear();
    if (phase === "beam" && phaseElapsedMs >= timing.beamMs / 2) {
      beam.rect(166, 69, 56, 3).fill(skin.colors.beam);
      beam.rect(166, 70, 62, 1).fill(0xffffff);
      beam.circle(225, 70, 6).fill(0xffeeab);
    }
  });
  showState();
  await refresh(false);
  if (native) setInterval(() => { void refresh(); }, timing.usageRefreshMs);
  while (true) {
    if (document.hidden) { await pause(600); continue; }
    if (enemyMode !== "ready") { await pause(100); continue; }
    if (pileCount() === 0) { await pause(100); continue; }
    reservedBar = true;
    takeProgress = 0;
    setPhase("take");
    await pause(timing.takeMs);
    setPhase("eat");
    sound("eat");
    await pause(timing.eatMs);
    setPhase("beam");
    sound("beam");
    await pause(timing.beamMs);
    const waveBefore = game.wave;
    try { game = await call("perform_attack"); reservedBar = false; showState(); }
    catch (error) { reservedBar = false; game.lastError = String(error); showState(); setPhase("idle"); await pause(600); continue; }
    const defeated = waveBefore !== game.wave;
    if (defeated) setEnemyMode("defeated");
    setPhase(defeated ? "victory" : "hit");
    sound(defeated ? "victory" : "hit");
    await pause(defeated ? timing.defeatMs : timing.hitMs);
    setPhase("idle");
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
