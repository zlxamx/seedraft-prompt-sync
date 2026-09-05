import { Notice, Plugin, TFolder, normalizePath } from "obsidian";
import type JSZip from "jszip";
import { computeFileDiff, type FileDiff } from "./diffview";
import { GitHubClient } from "./github";
import { ConfirmUpgradeModal, pick, showUpgradeResult } from "./modals";
import { readFileIfExists, scanProjects } from "./scanner";
import { DEFAULT_SETTINGS, SeedraftSettingTab, type SeedraftSettings } from "./settings";
import type { BProject, CheckResult, StandardManifest } from "./types";
import { analyzeUpgrade, applyUpgrade } from "./upgrader";
import { compareSemver, sha256Hex, today } from "./utils";
import { SyncView, VIEW_TYPE } from "./view";
import { loadZip, readManifestFromZip, readZipText, STANDARD_ID, STATE_FILE_NAME } from "./zip";

export default class SeedraftSyncPlugin extends Plugin {
  settings!: SeedraftSettings;
  private client: GitHubClient | null = null;
  projects: BProject[] = [];
  checkResult: CheckResult | null = null;
  checking = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new SeedraftSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => new SyncView(leaf, this));
    this.addRibbonIcon("refresh-cw", "Seedraft 同步", () => this.activateView());
    this.addCommand({ id: "open-panel", name: "打开同步面板", callback: () => this.activateView() });
    this.addCommand({
      id: "check-updates",
      name: "检查标准库更新",
      callback: async () => {
        await this.checkUpdates(true);
        await this.refreshView();
      },
    });
    this.addCommand({ id: "import-zip", name: "从 ZIP 导入", callback: () => this.pickZipAndImport() });
    this.addCommand({ id: "register-project", name: "登记旧项目", callback: () => this.registerOldProject() });

    this.app.workspace.onLayoutReady(async () => {
      await this.refreshProjects();
      await this.checkUpdates(false);
      await this.refreshView();
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // 加载时净化 token（旧版本可能存过带空白字符的值）
    this.settings.token = (this.settings.token || "").replace(/\s+/g, "");
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  invalidateClient(): void {
    this.client = null;
  }

  getClient(): GitHubClient {
    if (!this.client) {
      this.client = new GitHubClient(this.settings.repo || DEFAULT_SETTINGS.repo, this.settings.token);
    }
    return this.client;
  }

  async refreshProjects(): Promise<void> {
    this.projects = await scanProjects(this.app.vault);
  }

  private async refreshView(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof SyncView) await leaf.view.render();
    }
  }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const right = this.app.workspace.getRightLeaf(false);
      if (!right) return;
      leaf = right;
    }
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    await this.refreshProjects();
    if (leaf.view instanceof SyncView) await leaf.view.render();
  }

  // ------------------------------------------------------------------
  // 检查更新
  // ------------------------------------------------------------------
  async checkUpdates(force = false): Promise<void> {
    const now = Date.now();
    const intervalMs = this.settings.checkIntervalHours * 3600 * 1000;
    if (!force && now - this.settings.lastCheckAt < intervalMs) {
      new Notice("距上次检查不足设定间隔，已跳过（可用「检查标准库更新」命令强制检查）");
      return;
    }
    if (!this.settings.token) {
      this.checkResult = { ok: false, error: "未配置 GitHub Token", checkedAt: now };
      new Notice("Seedraft 同步：未配置 GitHub Token，无法在线检查；可先用「从 ZIP 导入」");
      return;
    }
    this.checking = true;
    try {
      const { tag, manifest } = await this.getClient().getLatestManifest();
      if (manifest.standardId !== STANDARD_ID) {
        throw new Error(`standardId 不匹配：${manifest.standardId}`);
      }
      await this.refreshProjects();
      this.checkResult = { ok: true, manifest, tag, checkedAt: now };
      this.settings.lastCheckAt = now;
      await this.saveSettings();
      const registered = this.projects.filter((p) => p.state).length;
      const upgradable = this.projects.filter(
        (p) => p.state && compareSemver(p.state.standardVersion, manifest.version) < 0
      ).length;
      if (registered === 0) {
        new Notice(`Seedraft 标准库最新版本 v${manifest.version}；Vault 中还没有已登记项目，请先「登记旧项目」`);
      } else if (upgradable > 0) {
        new Notice(`Seedraft 标准库有新版本 v${manifest.version}，${upgradable}/${registered} 个项目可升级`);
      } else {
        new Notice(`Seedraft 标准库最新版本 v${manifest.version}，${registered} 个已登记项目均是最新`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.checkResult = { ok: false, error: message, checkedAt: now };
      new Notice(`Seedraft 同步：检查失败——${message}`);
    } finally {
      this.checking = false;
      await this.refreshView();
    }
  }

  // ------------------------------------------------------------------
  // 升级（在线 / ZIP）
  // ------------------------------------------------------------------
  async upgradeProjectOnline(proj: BProject): Promise<void> {
    const result = this.checkResult;
    if (!result?.ok || !result.manifest) {
      new Notice("请先检查更新");
      return;
    }
    if (!this.settings.token) {
      new Notice("在线升级需要 GitHub Token；无网络时可把发布 ZIP 放进 Vault，用「从 ZIP 导入」");
      return;
    }
    try {
      new Notice(`正在下载 v${result.manifest.version} 发布包…`);
      const zip = await this.getClient().getZipByTag(result.tag!);
      await this.upgradeWithZip(proj, zip, result.manifest);
    } catch (e) {
      new Notice(`升级失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async upgradeWithZip(proj: BProject, zip: JSZip, manifest: StandardManifest): Promise<void> {
    if (!proj.state) {
      new Notice("该项目没有版本记录，请先登记");
      return;
    }
    const analysis = await analyzeUpgrade(this.app, proj, zip, manifest);
    if (analysis.targets.length === 0) {
      new Notice("该版本没有需要迁移的标准文件");
      return;
    }
    if (analysis.clean.length === 0 && analysis.newFiles.length === 0 && analysis.missingInZip.length > 0) {
      new Notice(`发布包缺少目标文件：${analysis.missingInZip.join("、")}，无法升级`);
      return;
    }

    const migrationText = manifest.migration ? await readZipText(zip, manifest.migration) : null;
    const lines: string[] = [
      `从 v${analysis.fromVersion} 升级到 v${manifest.version}`,
      `直接更新：${analysis.clean.length > 0 ? analysis.clean.join("、") : "（无）"}`,
      `新建文件：${analysis.newFiles.length > 0 ? analysis.newFiles.join("、") : "（无）"}`,
      `冲突（保留本地，不覆盖）：${analysis.conflicts.length > 0 ? analysis.conflicts.map((c) => c.path).join("、") : "（无）"}`,
    ];
    if (analysis.missingInZip.length > 0) {
      lines.push(`⚠ 发布包缺少：${analysis.missingInZip.join("、")}（本次跳过）`);
    }
    if (migrationText) {
      lines.push("", "———— 升级说明 ————");
      for (const l of migrationText.split("\n")) lines.push(l);
    }

    // 逐文件行级 diff：直接更新/冲突 = B 侧现状 vs 新版本；新建 = 空 vs 新版本
    const diffs: FileDiff[] = [];
    for (const t of analysis.targets) {
      const newText = (await readZipText(zip, t)) ?? "";
      const inClean = analysis.clean.includes(t);
      const isConflict = analysis.conflicts.some((c) => c.path === t);
      const isNew = analysis.newFiles.includes(t);
      const oldText =
        inClean || isConflict
          ? (await readFileIfExists(this.app.vault, normalizePath(proj.rootPath + t))) ?? ""
          : "";
      const d = computeFileDiff(oldText, newText);
      diffs.push({
        path: t,
        status: isNew ? "new" : isConflict ? "conflict" : "update",
        fileTime: manifest.fileTimes?.[t],
        ...d,
      });
    }

    new ConfirmUpgradeModal(
      this.app,
      `升级 ${proj.rootPath}`,
      lines,
      diffs,
      async (replacePaths) => {
        try {
          const report = await applyUpgrade(this.app, proj, zip, manifest, analysis, replacePaths);
          await this.refreshProjects();
          await this.refreshView();
          showUpgradeResult(this.app, [
            `已更新 ${report.updated.length} 个文件`,
            `其中冲突替换 ${report.replaced.length} 个（已备份）`,
            `保留本地 ${report.conflicts.length - report.replaced.length} 个（详见升级记录）`,
            `已备份 ${report.backedUp.length} 个文件 → seedraft-backup/v${report.fromVersion}/`,
            `升级记录：${report.recordPath}`,
          ]);
        } catch (e) {
          new Notice(`升级失败：${e instanceof Error ? e.message : String(e)}`);
        }
      },
      () => {
        /* 取消 */
      }
    ).open();
  }

  // ------------------------------------------------------------------
  // ZIP 导入
  // ------------------------------------------------------------------
  async pickZipAndImport(): Promise<void> {
    const zipFiles = this.app.vault.getFiles().filter((f) => f.extension === "zip");
    if (zipFiles.length === 0) {
      new Notice("Vault 中没有 .zip 文件；请先把标准库发布包放进 Vault");
      return;
    }
    pick(
      this.app,
      zipFiles,
      (f) => f.path,
      "选择发布 ZIP…",
      async (file) => {
        try {
          const buf = await this.app.vault.readBinary(file);
          const zip = await loadZip(buf);
          const manifest = await readManifestFromZip(zip);
          if (manifest.standardId !== STANDARD_ID) {
            new Notice(`standardId 不匹配：${manifest.standardId}，已拒绝`);
            return;
          }
          await this.refreshProjects();
          const candidates = this.projects.filter(
            (p) =>
              p.state &&
              p.state.standardId === STANDARD_ID &&
              compareSemver(p.state.standardVersion, manifest.version) < 0
          );
          if (candidates.length === 0) {
            new Notice("没有可升级的项目：都已是最新，或还没有登记（请先「登记旧项目」）");
            return;
          }
          if (candidates.length === 1) {
            await this.upgradeWithZip(candidates[0], zip, manifest);
          } else {
            pick(
              this.app,
              candidates,
              (p) => p.rootPath,
              "选择要升级的项目…",
              (proj) => this.upgradeWithZip(proj, zip, manifest)
            );
          }
        } catch (e) {
          new Notice(`ZIP 导入失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }
    );
  }

  // ------------------------------------------------------------------
  // 登记旧项目
  // ------------------------------------------------------------------
  async registerOldProject(): Promise<void> {
    const candidates: TFolder[] = [];
    const seen = new Set<string>();
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.name !== "Gemini.md" || !f.parent) continue;
      if (seen.has(f.parent.path)) continue;
      seen.add(f.parent.path);
      if (await this.app.vault.adapter.exists(`${f.parent.path}/${STATE_FILE_NAME}`)) continue;
      candidates.push(f.parent);
    }
    if (candidates.length === 0) {
      new Notice("没有找到未登记的项目（含 Gemini.md 且无版本记录的目录）");
      return;
    }
    if (!this.settings.token) {
      new Notice("登记需要 GitHub Token 下载官方基线；请先在设置里填写");
      return;
    }

    pick(
      this.app,
      candidates,
      (f) => f.path,
      "选择要登记的项目目录…",
      async (folder) => {
        try {
          const tags = await this.getClient().listTags();
          if (tags.length === 0) {
            new Notice("标准库仓库没有 tag，无法登记");
            return;
          }
          pick(
            this.app,
            tags,
            (t) => t,
            "选择该项目基于的标准库版本…",
            async (tag) => {
              try {
                new Notice("正在下载官方基线…");
                const zip = await this.getClient().getZipByTag(tag);
                const manifest = await readManifestFromZip(zip);
                if (manifest.standardId !== STANDARD_ID) {
                  new Notice(`standardId 不匹配：${manifest.standardId}`);
                  return;
                }
                const modified: string[] = [];
                for (const std of manifest.standardFiles) {
                  const theirs = await readFileIfExists(this.app.vault, `${folder.path}/${std.path}`);
                  if (theirs == null) continue;
                  const hash = await sha256Hex(theirs);
                  if (manifest.hashes[std.path] && manifest.hashes[std.path] !== hash) modified.push(std.path);
                }
                const lines = [
                  `项目：${folder.path}`,
                  `基于版本：v${manifest.version}`,
                  `标准文件：${manifest.standardFiles.length} 个`,
                  `本地已改动（以后升级会作为冲突报告）：${modified.length > 0 ? modified.join("、") : "（无）"}`,
                ];
                new ConfirmUpgradeModal(
                  this.app,
                  "登记旧项目",
                  lines,
                  [],
                  async () => {
                    try {
                      const state = {
                        schema: 1,
                        standardId: manifest.standardId,
                        standardVersion: manifest.version,
                        registeredAt: today(),
                        files: manifest.hashes,
                      };
                      await this.app.vault.create(
                        `${folder.path}/${STATE_FILE_NAME}`,
                        JSON.stringify(state, null, 2) + "\n"
                      );
                      await this.refreshProjects();
                      await this.refreshView();
                      new Notice(`已登记：${folder.path}（基于 v${manifest.version}）`);
                    } catch (e) {
                      new Notice(`登记失败：${e instanceof Error ? e.message : String(e)}`);
                    }
                  },
                  () => {
                    /* 取消 */
                  },
                  "确认登记"
                ).open();
              } catch (e) {
                new Notice(`登记失败：${e instanceof Error ? e.message : String(e)}`);
              }
            }
          );
        } catch (e) {
          new Notice(`获取版本列表失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }
    );
  }
}
