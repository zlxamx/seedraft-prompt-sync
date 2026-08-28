import { diffLines } from "diff";

export interface DiffLine {
  type: "add" | "del";
  text: string;
}

export interface FileDiff {
  path: string;
  status: "update" | "new" | "conflict";
  added: number;
  removed: number;
  lines: DiffLine[];
  truncated: boolean;
  /** 官方最后修改时间（ISO），仅展示 */
  fileTime?: string;
}

/**
 * 行级 diff：oldText（B 侧当前内容）→ newText（新版本包内容）。
 * 只保留变化行（+/-），不显示上下文；超过 maxLines 截断。
 */
export function computeFileDiff(oldText: string, newText: string, maxLines = 120): Omit<FileDiff, "path" | "status"> {
  const parts = diffLines(oldText, newText);
  let added = 0;
  let removed = 0;
  const lines: DiffLine[] = [];
  for (const p of parts) {
    const ls = p.value.split("\n");
    if (ls[ls.length - 1] === "") ls.pop();
    if (p.added) {
      added += ls.length;
      for (const l of ls) lines.push({ type: "add", text: l });
    } else if (p.removed) {
      removed += ls.length;
      for (const l of ls) lines.push({ type: "del", text: l });
    }
  }
  let truncated = false;
  if (lines.length > maxLines) {
    lines.length = maxLines;
    truncated = true;
  }
  return { added, removed, lines, truncated };
}
