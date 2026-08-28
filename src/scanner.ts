import type { Vault } from "obsidian";
import { TFolder } from "obsidian";
import type { BProject, BState } from "./types";
import { OLD_STATE_FILE_NAME, STATE_FILE_NAME } from "./zip";

/**
 * 扫描 Vault 内所有含 seedraft-standard.json 的目录，每个目录是一个 B 项目。
 * 状态文件解析失败的也返回（state 为 null，界面显示异常）。
 *
 * 注意：Obsidian 不索引点开头的文件，状态文件必须用不带点的名字。
 * 旧版（v0.1.2 及以前）使用的 .seedraft-standard.json 会在扫描时自动迁移。
 */
export async function scanProjects(vault: Vault): Promise<BProject[]> {
  await migrateOldStateFiles(vault);

  const projects: BProject[] = [];
  for (const f of vault.getFiles()) {
    if (f.name !== STATE_FILE_NAME) continue;
    const statePath = f.path;
    const rootPath = f.parent ? f.parent.path + "/" : "";
    let state: BState | null = null;
    try {
      state = JSON.parse(await vault.adapter.read(statePath)) as BState;
    } catch {
      state = null;
    }
    projects.push({ rootPath, statePath, state });
  }
  projects.sort((a, b) => a.rootPath.localeCompare(b.rootPath));
  return projects;
}

/** 旧版点开头状态文件 → 新名（vault.create 使新文件立即进入索引）。 */
async function migrateOldStateFiles(vault: Vault): Promise<void> {
  const folders = vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);
  for (const folder of folders) {
    const oldPath = `${folder.path}/${OLD_STATE_FILE_NAME}`;
    const newPath = `${folder.path}/${STATE_FILE_NAME}`;
    const oldExists = await vault.adapter.exists(oldPath);
    if (!oldExists) continue;
    if (await vault.adapter.exists(newPath)) {
      await vault.adapter.remove(oldPath);
      continue;
    }
    try {
      const content = await vault.adapter.read(oldPath);
      await vault.create(newPath, content);
      await vault.adapter.remove(oldPath);
    } catch {
      /* 迁移失败不阻断扫描 */
    }
  }
}

/** 判断目录下是否有某个文件。 */
export function folderHasFile(vault: Vault, folderPath: string, fileName: string): boolean {
  return vault.getAbstractFileByPath(`${folderPath}/${fileName}`) != null;
}
