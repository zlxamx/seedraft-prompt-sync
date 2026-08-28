import type { WorkspaceLeaf } from "obsidian";
import { ButtonComponent, ItemView } from "obsidian";
import type SeedraftSyncPlugin from "./main";
import type { BProject, StandardManifest } from "./types";
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
    const el = this.contentEl;
    el.empty();
    el.addClass("seedraft-sync");

    const latest = this.plugin.checkResult;

    // ── 头部 ──
    const header = el.createDiv({ cls: "seedraft-header" });
    header.createEl("div", { cls: "seedraft-header-title", text: "Seedraft 同步" });
    header.createEl("div", { cls: "seedraft-header-sub", text: `标准库 ${this.plugin.settings.repo}` });

    // ── 标准库状态卡 ──
    const stdCard = el.createDiv({ cls: "seedraft-std-card" });
    const stdRow = stdCard.createDiv({ cls: "seedraft-std-row" });
    const stdInfo = stdRow.createDiv({ cls: "seedraft-std-info" });
    if (latest?.ok && latest.manifest) {
      stdInfo.createSpan({ cls: "seedraft-version", text: `v${latest.manifest.version}` });
      stdInfo.createSpan({ cls: "seedraft-badge seedraft-badge-ok", text: "标准库" });
      stdInfo.createDiv({
        cls: "seedraft-sub",
        text: latest.tag ? `${latest.tag} · 最近检查 ${this.formatTime(latest.checkedAt)}` : `最近检查 ${this.formatTime(latest.checkedAt)}`,
      });
    } else if (latest && !latest.ok) {
      stdInfo.createSpan({ cls: "seedraft-sub seedraft-error", text: latest.error ?? "检查失败" });
    } else {
      stdInfo.createSpan({ cls: "seedraft-sub", text: "尚未检查更新" });
    }
    new ButtonComponent(stdRow)
      .setButtonText(this.plugin.checking ? "检查中…" : "检查更新")
      .setCta()
      .setDisabled(this.plugin.checking)
      .onClick(async () => {
        await this.plugin.checkUpdates(true);
        await this.render();
      });

    // Token 引导
    if (!this.plugin.settings.token) {
      const warn = stdCard.createDiv({ cls: "seedraft-warn" });
      warn.createSpan({ text: "未配置 GitHub Token，无法在线检查" });
      new ButtonComponent(warn)
        .setButtonText("打开设置")
        .onClick(() => this.openSettings());
    }

    // ── 项目列表 ──
    el.createEl("div", {
      cls: "seedraft-section-title",
      text: `项目（${this.plugin.projects.length}）`,
    });
    const list = el.createDiv({ cls: "seedraft-projects" });
    if (this.plugin.projects.length === 0) {
      const empty = list.createDiv({ cls: "seedraft-empty" });
      empty.createDiv({ cls: "seedraft-empty-title", text: "还没有登记项目" });
      empty.createDiv({
        cls: "seedraft-sub",
        text: "登记一次后，标准库每次更新都会在这里提示你升级。",
      });
      new ButtonComponent(empty).setButtonText("登记旧项目").setCta().onClick(() => this.plugin.registerOldProject());
    } else {
      for (const proj of this.plugin.projects) {
        this.renderProject(list, proj, latest?.ok ? latest.manifest : undefined);
      }
    }

    // ── 工具区 ──
    const tools = el.createDiv({ cls: "seedraft-tools" });
    new ButtonComponent(tools).setButtonText("从 ZIP 导入").onClick(() => this.plugin.pickZipAndImport());
    new ButtonComponent(tools).setButtonText("登记旧项目").onClick(() => this.plugin.registerOldProject());
  }

  private renderProject(list: HTMLElement, proj: BProject, manifest?: StandardManifest): void {
    const card = list.createDiv({ cls: "seedraft-project" });
    card.createDiv({ cls: "seedraft-project-name", text: proj.rootPath.replace(/\/$/, "") });

    if (!proj.state) {
      card.createDiv({ cls: "seedraft-sub seedraft-error", text: "状态文件损坏，请重新登记" });
      return;
    }

    const cur = proj.state.standardVersion;
    const infoRow = card.createDiv({ cls: "seedraft-project-row" });

    if (manifest && compareSemver(cur, manifest.version) < 0) {
      infoRow.createSpan({ cls: "seedraft-version", text: `v${cur} → v${manifest.version}` });
      infoRow.createSpan({ cls: "seedraft-badge seedraft-badge-update", text: "可升级" });
      const changes = card.createDiv({ cls: "seedraft-changes" });
      if (manifest.changedFiles.length > 0) {
        const shown = manifest.changedFiles.slice(0, 3).join("、");
        const more = manifest.changedFiles.length > 3 ? ` 等 ${manifest.changedFiles.length} 个文件` : "";
        changes.setText(`本次更新：${shown}${more}`);
      }
      new ButtonComponent(card)
        .setButtonText("升级")
        .setCta()
        .onClick(() => this.plugin.upgradeProjectOnline(proj));
    } else {
      infoRow.createSpan({ cls: "seedraft-version", text: `v${cur}` });
      infoRow.createSpan({
        cls: "seedraft-badge seedraft-badge-ok",
        text: manifest ? "已最新" : "未检查更新",
      });
    }
  }

  private openSettings(): void {
    const app = this.app as unknown as {
      setting?: { open: () => void; openTabById: (id: string) => void };
    };
    app.setting?.open();
    app.setting?.openTabById("seedraft-prompt-sync");
  }

  private formatTime(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
  }
}
