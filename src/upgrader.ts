import type { App, Vault } from "obsidian";
import { normalizePath, TFile } from "obsidian";
import type JSZip from "jszip";
import type { BProject, ConflictEntry, StandardManifest, UpgradeAnalysis, UpgradeReport } from "./types";
import { sha256Hex, today } from "./utils";
import { readZipText } from "./zip";

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
    const theirs = await vault.adapter.read(theirsPath).catch(() => null);
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

/** 执行升级：备份 → 覆盖 → 升级记录 → 更新状态文件。调用前必须先 analyzeUpgrade。 */
export async function applyUpgrade(
  app: App,
  project: BProject,
  zip: JSZip,
  manifest: StandardManifest,
  analysis: UpgradeAnalysis
): Promise<UpgradeReport> {
  const vault = app.vault;
  const state = project.state;
  if (!state) throw new Error("项目缺少版本记录");

  const backupDir = normalizePath(`${project.rootPath}.seedraft-backup/v${analysis.fromVersion}`);
  const updated: string[] = [];
  const backedUp: string[] = [];

  const writeText = async (relPath: string, content: string) => {
    const full = normalizePath(project.rootPath + relPath);
    const existing = vault.getAbstractFileByPath(full);
    if (existing instanceof TFile) await vault.modify(existing, content);
    else await vault.create(full, content);
  };

  // 1. 备份 + 覆盖 clean 文件
  for (const rel of analysis.clean) {
    const theirs = await vault.adapter.read(normalizePath(project.rootPath + rel));
    const backupPath = normalizePath(`${backupDir}/${rel}`);
    const existingBackup = vault.getAbstractFileByPath(backupPath);
    if (existingBackup instanceof TFile) await vault.modify(existingBackup, theirs);
    else await vault.create(backupPath, theirs);
    backedUp.push(rel);

    const newText = await readZipText(zip, rel);
    if (newText == null) continue;
    await writeText(rel, newText);
    updated.push(rel);
  }

  // 2. 新建 B 侧不存在的文件
  for (const rel of analysis.newFiles) {
    const newText = await readZipText(zip, rel);
    if (newText == null) continue;
    await writeText(rel, newText);
    updated.push(rel);
  }

  // 3. 升级记录
  const recordPath = normalizePath(project.rootPath + "升级记录.md");
  await appendRecord(vault, recordPath, manifest, analysis);

  // 4. 更新状态文件：版本 + 官方基线哈希（冲突文件也更新为官方基线，下次升级会继续报告）
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
    backedUp,
    recordPath,
  };
}

async function appendRecord(
  vault: Vault,
  recordPath: string,
  manifest: StandardManifest,
  analysis: UpgradeAnalysis
) {
  const section = [
    `## ${today()} · v${analysis.fromVersion} → v${manifest.version}`,
    `- 变更文件：${analysis.targets.length > 0 ? analysis.targets.join("、") : "（无）"}`,
    `- 直接更新：${analysis.clean.length > 0 ? analysis.clean.join("、") : "（无）"}`,
    `- 新建文件：${analysis.newFiles.length > 0 ? analysis.newFiles.join("、") : "（无）"}`,
    `- 冲突（保留本地，未覆盖）：${analysis.conflicts.length > 0 ? analysis.conflicts.map((c) => c.path).join("、") : "（无）"}`,
    `- 备份：.seedraft-backup/v${analysis.fromVersion}/`,
    "",
  ].join("\n");

  const existing = await vault.adapter.read(recordPath).catch(() => null);
  if (existing == null) {
    await vault.create(recordPath, `# 升级记录\n\n${section}`);
  } else {
    const body = existing.trimEnd() + "\n\n" + section;
    const file = vault.getAbstractFileByPath(recordPath);
    if (file instanceof TFile) await vault.modify(file, body);
    else await vault.create(recordPath, body);
  }
}

export type { ConflictEntry };
