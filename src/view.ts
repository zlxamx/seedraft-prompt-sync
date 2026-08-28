import type { WorkspaceLeaf } from "obsidian";
import { ButtonComponent, ItemView } from "obsidian";
import type SeedraftSyncPlugin from "./main";
import type { BProject } from "./types";
import { compareSemver } from "./utils";

export const VIEW_TYPE = "seedraft-sync-view";

export class SyncView extends ItemView {
  plugin: SeedraftSyncPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: SeedraftSyncPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Seedraft 同步";
  }

  getIcon(): string {
    return "refresh-cw";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("seedraft-sync");

    const latest = this.plugin.checkResult;

    const status = container.createDiv({ cls: "seedraft-status" });
    if (latest?.ok && latest.manifest) {
      status.createEl("p", { text: `标准库最新版本：v${latest.manifest.version}（${latest.tag ?? ""}）` });
      const upgradable = this.plugin.projects.filter(
        (p) => p.state && compareSemver(p.state.standardVersion, latest.manifest!.version) < 0
      ).length;
      if (upgradable > 0) status.createEl("p", { text: `${upgradable} 个项目可升级` });
    } else if (latest && !latest.ok) {
      status.createEl("p", { text: `最近检查失败：${latest.error ?? "未知错误"}` });
    } else {
      status.createEl("p", { text: "尚未检查更新" });
    }

    const actions = container.createDiv({ cls: "seedraft-actions" });
    new ButtonComponent(actions)
      .setButtonText("检查更新")
      .onClick(async () => {
        await this.plugin.checkUpdates(true);
        await this.render();
      });
    new ButtonComponent(actions)
      .setButtonText("从 ZIP 导入")
      .onClick(() => this.plugin.pickZipAndImport());
    new ButtonComponent(actions)
      .setButtonText("登记旧项目")
      .onClick(() => this.plugin.registerOldProject());

    const list = container.createDiv({ cls: "seedraft-projects" });
    if (this.plugin.projects.length === 0) {
      list.createEl("p", {
        text: "Vault 中还没有登记的项目。对已有的小说项目运行「登记旧项目」建立版本记录。",
      });
    }
    for (const proj of this.plugin.projects) {
      this.renderProject(list, proj, latest?.manifest?.version);
    }
  }

  private renderProject(list: HTMLElement, proj: BProject, latestVersion?: string): void {
    const card = list.createDiv({ cls: "seedraft-project" });
    card.createDiv({ cls: "seedraft-project-name", text: proj.rootPath });
    const info = card.createDiv({ cls: "seedraft-project-info" });
    if (!proj.state) {
      info.setText("状态文件损坏或无法解析");
      return;
    }
    if (!latestVersion) {
      info.setText(`当前 v${proj.state.standardVersion}（尚未检查最新版本，请先「检查更新」）`);
      return;
    }
    const upgradable = compareSemver(proj.state.standardVersion, latestVersion) < 0;
    info.setText(
      upgradable
        ? `当前 v${proj.state.standardVersion} → 可升级到 v${latestVersion}`
        : `当前 v${proj.state.standardVersion}（已最新）`
    );
    if (upgradable) {
      new ButtonComponent(card)
        .setButtonText("升级")
        .setCta()
        .onClick(() => this.plugin.upgradeProjectOnline(proj));
    }
  }
}
