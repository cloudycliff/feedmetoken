import { Assets, Rectangle, Texture } from "pixi.js";

export type SkinCatalog = {
  defaultSkin: string;
  skins: { id: string; name: string }[];
};

type Animation = { frames: string[]; fps: number };

export type SkinManifest = {
  formatVersion: number;
  id: string;
  atlas: string;
  frames: Record<string, [number, number, number, number]>;
  objects: { floor: string; tray: string; bar: string };
  anchors: { girl: [number, number]; robot: [number, number] };
  animations: {
    girl: Record<"idle" | "take" | "eat" | "beam" | "hit" | "victory", Animation>;
    robot: Record<"entering" | "ready" | "hit" | "defeated", Animation>;
    machine: Record<"idle" | "active", Animation>;
  };
  effects: { beam: string; token: string; progress: string };
};

export type LoadedSkin = {
  manifest: SkinManifest;
  textures: Record<string, Texture>;
  colors: { beam: number; token: number; progress: number };
};

const skinCache = new Map<string, Promise<LoadedSkin>>();
const safeId = /^[a-z0-9-]{1,32}$/;
const safeFile = /^[a-z0-9-]+\.png$/;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export async function loadSkinCatalog(): Promise<SkinCatalog> {
  const catalog = await fetchJson("/skins/catalog.json") as SkinCatalog;
  if (!catalog || !Array.isArray(catalog.skins) || !safeId.test(catalog.defaultSkin)
    || !catalog.skins.some((skin) => skin.id === catalog.defaultSkin)
    || catalog.skins.some((skin) => !safeId.test(skin.id) || typeof skin.name !== "string")) {
    throw new Error("皮肤目录格式无效");
  }
  return catalog;
}

function color(value: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`无效的皮肤颜色：${value}`);
  return Number.parseInt(value.slice(1), 16);
}

function validateManifest(manifest: SkinManifest, id: string, width: number, height: number) {
  if (manifest.formatVersion !== 1 || manifest.id !== id || !safeFile.test(manifest.atlas)) {
    throw new Error(`${id} 的皮肤清单版本或资源路径无效`);
  }
  for (const [name, rect] of Object.entries(manifest.frames)) {
    if (!Array.isArray(rect) || rect.length !== 4 || rect.some((part) => !Number.isInteger(part))
      || rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0
      || rect[0] + rect[2] > width || rect[1] + rect[3] > height) {
      throw new Error(`${id} 的 ${name} 帧超出图集范围`);
    }
  }
  const required = [manifest.objects.floor, manifest.objects.tray, manifest.objects.bar];
  const requiredSizes: Record<string, [number, number]> = {
    [manifest.objects.floor]: [320, 16],
    [manifest.objects.tray]: [40, 8],
    [manifest.objects.bar]: [20, 10],
  };
  for (const group of Object.values(manifest.animations)) {
    for (const animation of Object.values(group)) {
      if (!Array.isArray(animation.frames) || animation.frames.length === 0
        || !Number.isFinite(animation.fps) || animation.fps <= 0) {
        throw new Error(`${id} 的动画配置无效`);
      }
      required.push(...animation.frames);
    }
  }
  if (required.some((frame) => !manifest.frames[frame])) throw new Error(`${id} 引用了不存在的帧`);
  for (const [group, size] of [["girl", [96, 80]], ["robot", [64, 80]], ["machine", [80, 64]]] as const) {
    for (const animation of Object.values(manifest.animations[group])) {
      for (const frame of animation.frames) requiredSizes[frame] = [...size];
    }
  }
  for (const [name, size] of Object.entries(requiredSizes)) {
    if (manifest.frames[name][2] !== size[0] || manifest.frames[name][3] !== size[1]) {
      throw new Error(`${id} 的 ${name} 帧尺寸应为 ${size.join("×")}`);
    }
  }
  for (const [group, bounds] of [["girl", [96, 80]], ["robot", [64, 80]]] as const) {
    const anchor = manifest.anchors[group];
    if (!Array.isArray(anchor) || anchor.length !== 2 || anchor.some((part, index) => !Number.isFinite(part) || part < 0 || part > bounds[index])) {
      throw new Error(`${id} 的 ${group} 锚点配置无效`);
    }
  }
  color(manifest.effects.beam);
  color(manifest.effects.token);
  color(manifest.effects.progress);
}

export async function loadSkin(catalog: SkinCatalog, id: string): Promise<LoadedSkin> {
  if (!catalog.skins.some((skin) => skin.id === id)) throw new Error(`未收录皮肤：${id}`);
  if (!skinCache.has(id)) {
    skinCache.set(id, (async () => {
      const manifest = await fetchJson(`/skins/${id}/manifest.json`) as SkinManifest;
      if (!manifest || !safeFile.test(manifest.atlas)) throw new Error(`${id} 的皮肤清单无效`);
      const atlas = await Assets.load<Texture>(`/skins/${id}/${manifest.atlas}`);
      atlas.source.scaleMode = "nearest";
      validateManifest(manifest, id, atlas.width, atlas.height);
      const textures: Record<string, Texture> = {};
      for (const [name, [x, y, width, height]] of Object.entries(manifest.frames)) {
        textures[name] = new Texture({ source: atlas.source, frame: new Rectangle(x, y, width, height) });
      }
      return {
        manifest,
        textures,
        colors: {
          beam: color(manifest.effects.beam),
          token: color(manifest.effects.token),
          progress: color(manifest.effects.progress),
        },
      };
    })());
  }
  try {
    return await skinCache.get(id)!;
  } catch (error) {
    skinCache.delete(id);
    throw error;
  }
}

export function animationFrame(skin: LoadedSkin, group: keyof SkinManifest["animations"], state: string, seconds: number): Texture {
  const animation = (skin.manifest.animations[group] as Record<string, Animation>)[state];
  const index = Math.floor(seconds * animation.fps) % animation.frames.length;
  return skin.textures[animation.frames[index]];
}
