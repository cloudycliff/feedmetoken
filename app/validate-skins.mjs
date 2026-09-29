import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "public", "skins");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const validId = (value) => typeof value === "string" && /^[a-z0-9-]{1,32}$/.test(value);
const validColor = (value) => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
const requiredStates = {
  girl: ["idle", "take", "eat", "beam", "hit", "victory"],
  robot: ["entering", "ready", "hit", "defeated"],
  machine: ["idle", "active"],
};

function verify(condition, message) {
  if (!condition) throw new Error(message);
}

const catalog = readJson(join(root, "catalog.json"));
verify(validId(catalog.defaultSkin) && Array.isArray(catalog.skins), "皮肤目录无效");
const ids = new Set();
for (const item of catalog.skins) {
  verify(validId(item.id) && typeof item.name === "string" && item.name.length > 0, "皮肤 ID 或名称无效");
  verify(!ids.has(item.id), `重复的皮肤 ID：${item.id}`);
  ids.add(item.id);
  const folder = join(root, item.id);
  const manifest = readJson(join(folder, "manifest.json"));
  verify(manifest.formatVersion === 1 && manifest.id === item.id, `${item.id} 的清单版本或 ID 无效`);
  verify(typeof manifest.atlas === "string" && /^[a-z0-9-]+\.png$/.test(manifest.atlas), `${item.id} 的图集路径无效`);
  const png = readFileSync(join(folder, manifest.atlas));
  verify(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${item.id} 的图集不是 PNG`);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  verify(manifest.frames && typeof manifest.frames === "object", `${item.id} 缺少帧定义`);
  for (const [name, rect] of Object.entries(manifest.frames)) {
    verify(Array.isArray(rect) && rect.length === 4 && rect.every(Number.isInteger)
      && rect[0] >= 0 && rect[1] >= 0 && rect[2] > 0 && rect[3] > 0
      && rect[0] + rect[2] <= width && rect[1] + rect[3] <= height,
    `${item.id} 的 ${name} 帧超出图集`);
  }
  const reference = (name) => verify(typeof name === "string" && name in manifest.frames, `${item.id} 引用了不存在的帧：${name}`);
  for (const name of [manifest.objects?.floor, manifest.objects?.tray, manifest.objects?.bar]) reference(name);
  const requiredSizes = {
    [manifest.objects.floor]: [320, 16],
    [manifest.objects.tray]: [40, 8],
    [manifest.objects.bar]: [20, 10],
  };
  const actorSizes = { girl: [96, 80], robot: [64, 80], machine: [80, 64] };
  for (const [group, states] of Object.entries(requiredStates)) {
    for (const state of states) {
      const animation = manifest.animations?.[group]?.[state];
      verify(animation && Array.isArray(animation.frames) && animation.frames.length > 0
        && Number.isFinite(animation.fps) && animation.fps > 0, `${item.id} 缺少 ${group}.${state} 动画`);
      animation.frames.forEach((name) => {
        reference(name);
        requiredSizes[name] = actorSizes[group];
      });
    }
  }
  for (const [name, size] of Object.entries(requiredSizes)) {
    verify(manifest.frames[name][2] === size[0] && manifest.frames[name][3] === size[1],
      `${item.id} 的 ${name} 帧尺寸应为 ${size.join("×")}`);
  }
  for (const group of ["girl", "robot"]) {
    const anchor = manifest.anchors?.[group];
    verify(Array.isArray(anchor) && anchor.length === 2
      && anchor.every((part, index) => Number.isFinite(part) && part >= 0 && part <= actorSizes[group][index]),
    `${item.id} 的 ${group} 锚点无效`);
  }
  for (const effect of ["beam", "token", "progress"]) {
    verify(validColor(manifest.effects?.[effect]), `${item.id} 的 ${effect} 颜色无效`);
  }
  if (manifest.idleIllustration) {
    const { asset, displayHeight } = manifest.idleIllustration;
    verify(typeof asset === "string" && /^[a-z0-9-]+\.png$/.test(asset)
      && Number.isFinite(displayHeight) && displayHeight > 0 && displayHeight <= 128,
    `${item.id} 的待机插画配置无效`);
    const illustration = readFileSync(join(folder, asset));
    verify(illustration.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && illustration.readUInt32BE(16) > 0 && illustration.readUInt32BE(20) > 0,
    `${item.id} 的待机插画不是有效 PNG`);
  }
}
verify(ids.has(catalog.defaultSkin), "默认皮肤不在目录中");
console.log(`皮肤资源校验通过（${ids.size} 套）`);
