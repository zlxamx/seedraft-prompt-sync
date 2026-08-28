/** SHA-256（UTF-8 内容），与 A 侧发布脚本口径一致。 */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** semver 比较（容忍 v 前缀）。a < b → 负数；相等 → 0；a > b → 正数。 */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((s) => Number(s) || 0);
  const pb = b.replace(/^v/, "").split(".").map((s) => Number(s) || 0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
