import type { Vault } from "obsidian";
import type { BProject, BState } from "./types";

/**
 * 扫描 Vault 内所有含 .seedraft-standard.json 的目录，每个目录是一个 B 项目。
 * 状态文件解析失败的也返回（state 为 null，界面显示异常）。
 */
export async function scanProjects(vault: Vault): Promise<BProject[]> {
  const projects: BProject[] = [];
  for (const f of vault.getFiles()) {
    if (f.name !== ".seedraft-standard.json") continue;
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

/** 判断目录下是否有某个文件。 */
export function folderHasFile(vault: Vault, folderPath: string, fileName: string): boolean {
  return vault.getAbstractFileByPath(`${folderPath}/${fileName}`) != null;
}
