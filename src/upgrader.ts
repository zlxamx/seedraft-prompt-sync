import type { App, Vault } from "obsidian";
import { normalizePath, TFile } from "obsidian";
import type JSZip from "jszip";
import type { BProject, ConflictEntry, StandardManifest, UpgradeAnalysis, UpgradeReport } from "./types";
import { sha256Hex, today } from "./utils";
import { readZipText } from "./zip";
import { readFileIfExists } from "./scanner";

/** 迁移目标：changedFiles 中属于白名单的文件；changedFiles 为空则取全部白名单。 */
function resolveTargets(manifest: StandardManifest): { path: string; mode: "overwrite" | "merge" }[] {
  const byPath = new Map(manifest.standardFiles.map((f) => [f.path, f]));
  if (manifest.changedFiles.length > 0) {
    const targets: { path: string; mode: "overwrite" | "merge" }[] = [];
    for (const p of manifest.changedFiles) {
      const entry = byPath.get(p);
      if (entry) targets.push(entry);
    }
    return targets;
  }
  return manifest.standardFiles.map((f) => ({ path: f.path, mode: f.mode }));
}

/** 升级前预演：三方判断，不写任何文件。 */
export async function analyzeUpgrade(
  app: App,
  project: BProject,
  zip: JSZip,
  manifest: StandardManifest
): Promise<UpgradeAnalysis> {
  const vault = app.vault;
  const state = project.state;
  if (!state) throw new Error("项目缺少版本记录，请先登记");
  if (state.standardId !== manifest.standardId) {
    throw new Error(`标准库标识不匹配：B 是 ${state.standardId}，包是 ${manifest.standardId}`);
  }

  const targets = resolveTargets(manifest);
  const analysis: UpgradeAnalysis = {
    fromVersion: state.standardVersion,
    toVersion: manifest.version,
    targets: targets.map((t) => t.path),
    clean: [],
    newFiles: [],
    conflicts: [],
    missingInZip: [],
  };

  for (const t of targets) {
    const zipEntry = zip.file(t.path);
    if (!zipEntry) {
      analysis.missingInZip.push(t.path);
      continue;
    }
    const theirsPath = normalizePath(project.rootPath + t.path);
    const theirs = await readFileIfExists(vault, theirsPath);
    if (theirs == null) {
      analysis.newFiles.push(t.path);
      continue;
    }
    const theirsHash = await sha256Hex(theirs);
    const base = state.files?.[t.path];
    if (base && base === theirsHash) {
      analysis.clean.push(t.path);
    } else {
      analysis.conflicts.push({ path: t.path, mode: t.mode, reason: "locally-modified" });
    }
  }
  return analysis;
}

/** 执行升级：备份 → 覆盖 → 升级记录 → 更新状态文件。调用前必须先 analyzeUpgrade。
 *  replacePaths：用户选择“替换”的冲突文件路径（备份后覆盖为官方新版），其余冲突保留本地。 */
export async function applyUpgrade(
  app: App,
  project: BProject,
  zip: JSZip,
  manifest: StandardManifest,
  analysis: UpgradeAnalysis,
  replacePaths: string[] = []
): Promise<UpgradeReport> {
  const vault = app.vault;
  const state = project.state;
  if (!state) throw new Error("项目缺少版本记录");

  const backupDir = normalizePath(`${project.rootPath}seedraft-backup/v${analysis.fromVersion}`);
  const updated: string[] = [];
  const backedUp: string[] = [];
  const replaced: string[] = [];

  // 备份与写入前确保父目录存在（vault.create 不会自动建目录）
  const ensureParent = async (fullPath: string) => {
    const parent = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (parent && !vault.getFolderByPath(parent)) {
      await vault.createFolder(parent).catch(() => {});
    }
  };

  const writeText = async (relPath: string, content: string) => {
    const full = normalizePath(project.rootPath + relPath);
    await ensureParent(full);
    const existing = vault.getAbstractFileByPath(full);
    if (existing instanceof TFile) await vault.modify(existing, content);
    else await vault.create(full, content);
  };

  const backupFile = async (relPath: string, content: string) => {
    const backupPath = normalizePath(`${backupDir}/${relPath}`);
    await ensureParent(backupPath);
    const existingBackup = vault.getAbstractFileByPath(backupPath);
    if (existingBackup instanceof TFile) await vault.modify(existingBackup, content);
    else await vault.create(backupPath, content);
  };

  // 1. 备份 + 覆盖 clean 文件
  for (const rel of analysis.clean) {
    const full = normalizePath(project.rootPath + rel);
    const theirs = await readFileIfExists(vault, full);
    if (theirs != null) {
      await backupFile(rel, theirs);
      backedUp.push(rel);
    }
    const newText = await readZipText(zip, rel);
    if (newText == null) continue;
    await writeText(rel, newText);
    updated.push(rel);
  }

  // 2. 新建 B 侧不存在的文件
  for (const rel of analysis.newFiles) {
    const newText = await readZipText(zip, rel);
    if (newText == null) continue;
    const full = normalizePath(project.rootPath + rel);
    // 保险：磁盘上已有文件（索引外残留，如 iCloud 同步延迟），先备份再覆盖
    if (await vault.adapter.exists(full)) {
      const theirs = await vault.adapter.read(full);
      await backupFile(rel, theirs);
      backedUp.push(rel);
    }
    await writeText(rel, newText);
    updated.push(rel);
  }

  // 3. 用户选择替换的冲突文件：备份 + 覆盖官方新版
  const replaceSet = new Set(replacePaths);
  for (const c of analysis.conflicts) {
    if (!replaceSet.has(c.path)) continue;
    const full = normalizePath(project.rootPath + c.path);
    const theirs = await readFileIfExists(vault, full);
    if (theirs != null) {
      await backupFile(c.path, theirs);
      backedUp.push(c.path);
    }
    const newText = await readZipText(zip, c.path);
    if (newText == null) continue;
    await writeText(c.path, newText);
    updated.push(c.path);
    replaced.push(c.path);
  }

  // 4. 升级记录
  const recordPath = normalizePath(project.rootPath + "升级记录.md");
  await appendRecord(vault, recordPath, manifest, analysis, replaced);

  // 5. 更新状态文件：版本 + 官方基线哈希（冲突文件也更新为官方基线，下次升级会继续报告）
  const files: Record<string, string> = {};
  for (const f of manifest.standardFiles) {
    if (manifest.hashes[f.path]) files[f.path] = manifest.hashes[f.path];
  }
  const newState = {
    schema: 1,
    standardId: state.standardId,
    standardVersion: manifest.version,
    registeredAt: state.registeredAt,
    files,
  };
  const stateFile = vault.getAbstractFileByPath(project.statePath);
  if (stateFile instanceof TFile) await vault.modify(stateFile, JSON.stringify(newState, null, 2) + "\n");

  return {
    fromVersion: analysis.fromVersion,
    toVersion: manifest.version,
    updated,
    conflicts: analysis.conflicts,
    replaced,
    backedUp,
    recordPath,
  };
}

async function appendRecord(
  vault: Vault,
  recordPath: string,
  manifest: StandardManifest,
  analysis: UpgradeAnalysis,
  replaced: string[]
) {
  const kept = analysis.conflicts.filter((c) => !replaced.includes(c.path)).map((c) => c.path);
  const section = [
    `## ${today()} · v${analysis.fromVersion} → v${manifest.version}`,
    `- 变更文件：${analysis.targets.length > 0 ? analysis.targets.join("、") : "（无）"}`,
    `- 直接更新：${analysis.clean.length > 0 ? analysis.clean.join("、") : "（无）"}`,
    `- 新建文件：${analysis.newFiles.length > 0 ? analysis.newFiles.join("、") : "（无）"}`,
    `- 冲突（你选择替换为官方新版）：${replaced.length > 0 ? replaced.join("、") : "（无）"}`,
    `- 冲突（保留本地，未覆盖）：${kept.length > 0 ? kept.join("、") : "（无）"}`,
    `- 备份：seedraft-backup/v${analysis.fromVersion}/`,
    "",
  ].join("\n");

  const existing = vault.getAbstractFileByPath(recordPath);
  const existingText = existing instanceof TFile ? await vault.read(existing) : null;
  if (existingText == null) {
    const parent = recordPath.substring(0, recordPath.lastIndexOf("/"));
    if (parent && !vault.getFolderByPath(parent)) {
      await vault.createFolder(parent).catch(() => {});
    }
    await vault.create(recordPath, `# 升级记录\n\n${section}`);
  } else {
    const body = existingText.trimEnd() + "\n\n" + section;
    if (existing instanceof TFile) await vault.modify(existing, body);
    else await vault.create(recordPath, body);
  }
}

export type { ConflictEntry };
