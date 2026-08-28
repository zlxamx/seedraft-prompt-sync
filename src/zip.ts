import JSZip from "jszip";
import type { StandardManifest } from "./types";

export const STANDARD_ID = "seedraft-prompt-system";
export const STATE_FILE_NAME = "seedraft-standard.json";
/** 旧版状态文件名（v0.1.2 及以前），扫描时自动迁移 */
export const OLD_STATE_FILE_NAME = ".seedraft-standard.json";

export async function loadZip(buffer: ArrayBuffer | Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(buffer);
}

export async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  return entry.async("string");
}

/** 从发布 ZIP 根读取并校验 A 的版本清单。 */
export async function readManifestFromZip(zip: JSZip): Promise<StandardManifest> {
  const text = await readZipText(zip, "manifest.json");
  if (text == null) throw new Error("ZIP 中没有 manifest.json，不是有效的 Seedraft 发布包");
  const manifest = JSON.parse(text) as StandardManifest;
  if (!manifest.standardId || !manifest.version || !Array.isArray(manifest.standardFiles)) {
    throw new Error("manifest.json 字段不完整，无法使用");
  }
  if (manifest.schema > 1) throw new Error(`manifest schema ${manifest.schema} 超出插件支持范围，请升级插件`);
  return manifest;
}
