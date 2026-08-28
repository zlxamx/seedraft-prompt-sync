/** A 发布 manifest（标准库版本清单）与 B 侧状态文件的数据结构。 */

export type FileMode = "overwrite" | "merge";

export interface StandardFileEntry {
  path: string;
  mode: FileMode;
}

export interface StandardManifest {
  schema: number;
  standardId: string;
  version: string;
  releasedAt?: string;
  baseVersion: string;
  migration?: string;
  changedFiles: string[];
  standardFiles: StandardFileEntry[];
  hashes: Record<string, string>;
}

export interface BState {
  schema: number;
  standardId: string;
  standardVersion: string;
  registeredAt?: string;
  /** 标准文件在登记版本的官方基线哈希（三方判断的 base） */
  files: Record<string, string>;
}

export interface BProject {
  /** Vault 内相对路径，以 / 结尾 */
  rootPath: string;
  statePath: string;
  state: BState | null;
}

export interface CheckResult {
  ok: boolean;
  error?: string;
  manifest?: StandardManifest;
  tag?: string;
  checkedAt: number;
}

export interface ConflictEntry {
  path: string;
  mode: FileMode;
  reason: "locally-modified";
}

export interface UpgradeAnalysis {
  fromVersion: string;
  toVersion: string;
  targets: string[];
  /** 直接更新的文件（B 侧与基线一致） */
  clean: string[];
  /** B 侧不存在、直接新建的文件 */
  newFiles: string[];
  conflicts: ConflictEntry[];
  /** zip 中缺失、无法迁移的目标 */
  missingInZip: string[];
}

export interface UpgradeReport {
  fromVersion: string;
  toVersion: string;
  updated: string[];
  conflicts: ConflictEntry[];
  backedUp: string[];
  recordPath: string;
}
