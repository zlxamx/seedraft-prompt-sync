import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prod = process.argv[2] === "production";

// 本机 Obsidian Vault 插件目录（开发部署用；其他机器可改成自己的路径）
const VAULT_PLUGIN_DIR =
  "/Users/zhangluxi/Library/Mobile Documents/iCloud~md~obsidian/Documents/Luxi/小说/.obsidian/plugins/seedraft-prompt-sync";

const banner = { js: "/* Seedraft Prompt Sync */" };

async function build() {
  await esbuild.build({
    banner,
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron"],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
  });
  if (prod && fs.existsSync(VAULT_PLUGIN_DIR)) {
    for (const f of ["main.js", "manifest.json", "styles.css"]) {
      fs.copyFileSync(path.join(__dirname, f), path.join(VAULT_PLUGIN_DIR, f));
    }
    console.log(`已部署到 ${VAULT_PLUGIN_DIR}`);
  }
}

if (prod) {
  await build();
} else {
  const ctx = await esbuild.context({
    banner,
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron"],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: "inline",
    treeShaking: true,
    outfile: "main.js",
  });
  await ctx.watch();
  console.log("watch 模式运行中…");
}
