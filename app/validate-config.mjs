import { readFileSync } from "node:fs";

const sections = {
  rules: {
    positive: ["tokensPerBar", "startingLevel", "startingAttackPower", "startingWave", "enemyBaseHp", "enemyHpEveryWaves", "xpPerLevel", "upgradeCostPerAttackPower", "attackPowerPerUpgrade"],
    nonnegative: ["coinsPerDefeat", "xpPerDefeat"],
  },
  timing: {
    positive: ["usageRefreshMs", "enemyWalkPixelsPerSecond", "productionBatchMs", "takeMs", "eatMs", "beamMs", "defeatMs", "hitMs", "retryAfterHitMs", "activeFps", "idleFps"],
    nonnegative: [],
  },
  display: {
    positive: ["maxPileBars"],
    nonnegative: ["individualBarsPerRefresh"],
  },
  preview: {
    positive: [],
    nonnegative: ["startingBars", "tokensPerRefresh"],
  },
};

try {
  const config = JSON.parse(readFileSync(new URL("./game-config.json", import.meta.url), "utf8"));
  const expectedSections = Object.keys(sections);
  for (const section of expectedSections) {
    const values = config[section];
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error(`缺少 ${section} 配置组`);
    const { positive, nonnegative } = sections[section];
    const expectedKeys = [...positive, ...nonnegative];
    for (const key of expectedKeys) {
      const value = values[key];
      const minimum = positive.includes(key) ? 1 : 0;
      if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${section}.${key} 必须是大于等于 ${minimum} 的安全整数`);
    }
    for (const key of Object.keys(values)) {
      if (!expectedKeys.includes(key)) throw new Error(`未知配置项 ${section}.${key}`);
    }
  }
  for (const section of Object.keys(config)) {
    if (!expectedSections.includes(section)) throw new Error(`未知配置组 ${section}`);
  }
  if (config.timing.activeFps < config.timing.idleFps) throw new Error("timing.activeFps 不能小于 timing.idleFps");
  if (config.timing.activeFps > 60) throw new Error("timing.activeFps 不能大于 60");
  if (config.display.individualBarsPerRefresh > 20) throw new Error("display.individualBarsPerRefresh 不能大于 20");
  if (config.display.maxPileBars > 12) throw new Error("display.maxPileBars 不能大于 12，以免超出场景");
  console.log("游戏配置校验通过");
} catch (error) {
  console.error(`游戏配置校验失败：${error.message}`);
  process.exitCode = 1;
}
