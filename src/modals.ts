import type { App } from "obsidian";
import { ButtonComponent, FuzzySuggestModal, Modal, Notice } from "obsidian";
import type { FileDiff } from "./diffview";

const STATUS_TEXT: Record<FileDiff["status"], string> = {
  update: "直接更新",
  new: "新建",
  conflict: "冲突·保留本地",
};

const STATUS_CLS: Record<FileDiff["status"], string> = {
  update: "seedraft-diff-status-update",
  new: "seedraft-diff-status-new",
  conflict: "seedraft-diff-status-conflict",
};

/** 升级确认弹窗：展示迁移摘要、逐文件可展开的行级 diff（冲突文件可勾选“替换”）与升级说明。 */
export class ConfirmUpgradeModal extends Modal {
  private title: string;
  private lines: string[];
  private diffs: FileDiff[];
  private onConfirm: (replacePaths: string[]) => Promise<void>;
  private onCancel: () => void;
  private confirmText: string;
  private busy = false;
  private replaceSet = new Set<string>();

  constructor(
    app: App,
    title: string,
    lines: string[],
    diffs: FileDiff[],
    onConfirm: (replacePaths: string[]) => Promise<void>,
    onCancel: () => void,
    confirmText = "执行升级"
  ) {
    super(app);
    this.title = title;
    this.lines = lines;
    this.diffs = diffs;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.confirmText = confirmText;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("seedraft-modal");
    contentEl.createEl("h3", { text: this.title });

    const list = contentEl.createEl("div", { cls: "seedraft-confirm-list" });
    for (const line of this.lines) {
      list.createEl("div", { cls: "seedraft-confirm-line", text: line });
    }

    // 逐文件可展开 diff
    if (this.diffs.length > 0) {
      const diffTitle = contentEl.createEl("div", { cls: "seedraft-diff-title", text: "文件差异（点击展开；冲突文件勾选“替换”即用官方新版覆盖）" });
      for (const d of this.diffs) this.renderDiffItem(contentEl, d);
    }

    const buttons = contentEl.createDiv();
    buttons.style.display = "flex";
    buttons.style.gap = "8px";
    buttons.style.marginTop = "12px";
    new ButtonComponent(buttons)
      .setButtonText(this.confirmText)
      .setCta()
      .onClick(async () => {
        if (this.busy) return;
        this.busy = true;
        try {
          await this.onConfirm([...this.replaceSet]);
          this.close();
        } catch (e) {
          this.busy = false;
          new Notice(`操作失败：${e instanceof Error ? e.message : String(e)}`);
        }
      });
    new ButtonComponent(buttons).setButtonText("取消").onClick(() => {
      this.onCancel();
      this.close();
    });
  }

  private renderDiffItem(parent: HTMLElement, d: FileDiff): void {
    const item = parent.createDiv({ cls: "seedraft-diff-item" });
    const header = item.createDiv({ cls: "seedraft-diff-header" });
    const name = header.createSpan({ cls: "seedraft-diff-name", text: d.path });
    header.createSpan({ cls: `seedraft-diff-status ${STATUS_CLS[d.status]}`, text: STATUS_TEXT[d.status] });
    if (d.fileTime) {
      header.createSpan({ cls: "seedraft-diff-time", text: `官方更新于 ${formatDate(d.fileTime)}` });
    }

    // 冲突文件：替换复选框（勾选 → 升级时用官方新版覆盖并备份）
    let replaceLabel: HTMLElement | null = null;
    if (d.status === "conflict") {
      replaceLabel = header.createEl("label", { cls: "seedraft-diff-replace" });
      const cb = replaceLabel.createEl("input", { type: "checkbox" });
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked) this.replaceSet.add(d.path);
        else this.replaceSet.delete(d.path);
        if (cb.checked) {
          replaceLabel?.addClass("checked");
        } else {
          replaceLabel?.removeClass("checked");
        }
      });
      replaceLabel.createSpan({ text: "替换" });
    }

    header.createSpan({ cls: "seedraft-diff-stats", text: `+${d.added} -${d.removed}` });
    header.createSpan({ cls: "seedraft-diff-toggle", text: "▸" });

    const body = item.createDiv({ cls: "seedraft-diff-body" });
    body.hide();
    if (d.added === 0 && d.removed === 0) {
      body.createEl("div", { cls: "seedraft-diff-empty", text: "内容无变化" });
    } else {
      for (const l of d.lines) {
        body.createEl("div", {
          cls: l.type === "add" ? "seedraft-diff-add" : "seedraft-diff-del",
          text: (l.type === "add" ? "+ " : "- ") + l.text,
        });
      }
      if (d.truncated) {
        body.createEl("div", { cls: "seedraft-diff-more", text: "… 差异行过多，仅显示前 120 行" });
      }
    }
    header.addEventListener("click", () => {
      const shown = body.isShown();
      if (shown) body.hide();
      else body.show();
      const toggle = header.querySelector(".seedraft-diff-toggle");
      if (toggle) toggle.toggleClass("open", !shown);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 通用选择器。 */
export function pick<T>(
  app: App,
  items: T[],
  getText: (item: T) => string,
  placeholder: string,
  onChoose: (item: T) => void
): void {
  const modal = new (class extends FuzzySuggestModal<T> {
    getItems(): T[] {
      return items;
    }
    getItemText(item: T): string {
      return getText(item);
    }
    onChooseItem(item: T): void {
      onChoose(item);
    }
  })(app);
  modal.setPlaceholder(placeholder);
  modal.open();
}

/** 展示升级报告。 */
export function showUpgradeResult(app: App, lines: string[]): void {
  new (class extends Modal {
    onOpen(): void {
      const { contentEl } = this;
      contentEl.createEl("h3", { text: "升级完成" });
      const list = contentEl.createEl("div", { cls: "seedraft-confirm-list" });
      for (const line of lines) list.createEl("div", { text: line });
      const buttons = contentEl.createDiv();
      buttons.style.marginTop = "12px";
      new ButtonComponent(buttons).setButtonText("关闭").setCta().onClick(() => this.close());
    }
    onClose(): void {
      this.contentEl.empty();
    }
  })(app).open();
}
