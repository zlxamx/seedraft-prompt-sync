import { requestUrl } from "obsidian";
import type JSZip from "jszip";
import { loadZip, readManifestFromZip } from "./zip";
import type { StandardManifest } from "./types";

interface GitHubAsset {
  id: number;
  name: string;
}

interface ReleaseData {
  tag_name: string;
  assets: GitHubAsset[];
}

/**
 * GitHub Release API 客户端。私有仓库需要用户提供只读 PAT。
 * 资产下载统一走 api.github.com 的 assets 端点（避开 github.com
 * 下载域名的网络可达性问题）。
 */
export class GitHubClient {
  private repo: string;
  private token: string;

  constructor(repo: string, token: string) {
    this.repo = repo;
    this.token = token;
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async api<T>(path: string): Promise<T> {
    const res = await requestUrl({
      url: `https://api.github.com/repos/${this.repo}${path}`,
      headers: this.authHeaders({ Accept: "application/vnd.github+json" }),
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GitHub API ${res.status}: ${res.text.slice(0, 300)}`);
    }
    return res.json as T;
  }

  private async downloadAsset(assetId: number): Promise<ArrayBuffer> {
    const res = await requestUrl({
      url: `https://api.github.com/repos/${this.repo}/releases/assets/${assetId}`,
      headers: this.authHeaders({ Accept: "application/octet-stream" }),
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`下载失败 ${res.status}`);
    }
    return res.arrayBuffer;
  }

  async latestRelease(): Promise<ReleaseData> {
    return this.api<ReleaseData>("/releases/latest");
  }

  /** 最新 Release 的版本清单。优先读独立 manifest.json 资产，否则从 ZIP 里读。 */
  async getLatestManifest(): Promise<{ tag: string; manifest: StandardManifest }> {
    const release = await this.latestRelease();
    const manifestAsset = release.assets.find((a) => a.name === "manifest.json");
    if (manifestAsset) {
      const buf = await this.downloadAsset(manifestAsset.id);
      return { tag: release.tag_name, manifest: JSON.parse(new TextDecoder().decode(buf)) as StandardManifest };
    }
    const zipAsset = release.assets.find((a) => a.name.endsWith(".zip"));
    if (!zipAsset) throw new Error(`Release ${release.tag_name} 没有 manifest.json 或 ZIP 资产`);
    const zip = await this.getZipByTag(release.tag_name);
    return { tag: release.tag_name, manifest: await readManifestFromZip(zip) };
  }

  /** 按 tag 下载发布 ZIP 并解压。 */
  async getZipByTag(tag: string): Promise<JSZip> {
    const release = await this.api<ReleaseData>(`/releases/tags/${tag}`);
    const zipAsset = release.assets.find((a) => a.name.endsWith(".zip"));
    if (!zipAsset) throw new Error(`Release ${tag} 没有 ZIP 资产`);
    const buf = await this.downloadAsset(zipAsset.id);
    return loadZip(buf);
  }

  /** 仓库 tag 列表（用于登记旧项目时选择版本）。 */
  async listTags(): Promise<string[]> {
    const data = await this.api<{ name: string }[]>("/tags?per_page=50");
    return data.map((t) => t.name);
  }
}
