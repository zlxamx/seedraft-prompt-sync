import type { App } from "obsidian";
import { ButtonComponent, FuzzySuggestModal, Modal, Notice } from "obsidian";

/** 升级确认弹窗：展示迁移摘要与三方预演结果，确认后执行。 */
export class ConfirmUpgradeModal extends Modal {
  private title: string;
  private lines: string[];
  private onConfirm: () => Promise<void>;
  private onCancel: () => void;
  private confirmText: string;
  private busy = false;

  constructor(
    app: App,
    title: string,
    lines: string[],
    onConfirm: () => Promise<void>,
    onCancel: () => void,
    confirmText = "执行升级"
  ) {
    super(app);
    this.title = title;
    this.lines = lines;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.confirmText = confirmText;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    const list = contentEl.createEl("div", { cls: "seedraft-confirm-list" });
    for (const line of this.lines) {
      list.createEl("div", { text: line });
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
          await this.onConfirm();
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

  onClose(): void {
    this.contentEl.empty();
  }
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
