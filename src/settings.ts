import type { App } from "obsidian";
import { PluginSettingTab, Setting } from "obsidian";
import type SeedraftSyncPlugin from "./main";

export interface SeedraftSettings {
  repo: string;
  token: string;
  checkIntervalHours: number;
  lastCheckAt: number;
}

export const DEFAULT_SETTINGS: SeedraftSettings = {
  repo: "zlxamx/Seedraft-Prompt-System",
  token: "",
  checkIntervalHours: 24,
  lastCheckAt: 0,
};

export class SeedraftSettingTab extends PluginSettingTab {
  plugin: SeedraftSyncPlugin;

  constructor(app: App, plugin: SeedraftSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("GitHub Token").setHeading();

    new Setting(containerEl)
      .setName("访问令牌")
      .setDesc("标准库是私有仓库时需要。只需 repo 只读权限（勾选 repo → public_repo 或私有仓库读取）。仅保存在本机插件配置中。")
      .addText((text) =>
        text
          .setPlaceholder("ghp_… 或 gho_…")
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            this.plugin.settings.token = value.trim();
            this.plugin.invalidateClient();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("标准库仓库")
      .setDesc("owner/repo 格式。")
      .addText((text) =>
        text
          .setPlaceholder("zlxamx/Seedraft-Prompt-System")
          .setValue(this.plugin.settings.repo)
          .onChange(async (value) => {
            this.plugin.settings.repo = value.trim();
            this.plugin.invalidateClient();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("检查频率").setHeading();

    new Setting(containerEl)
      .setName("自动检查间隔（小时）")
      .setDesc("打开 Obsidian 时若距上次检查超过该间隔，会自动检查一次。随时可用命令强制检查。")
      .addText((text) =>
        text
          .setPlaceholder("24")
          .setValue(String(this.plugin.settings.checkIntervalHours))
          .onChange(async (value) => {
            const n = Number(value);
            if (Number.isFinite(n) && n > 0) {
              this.plugin.settings.checkIntervalHours = n;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
