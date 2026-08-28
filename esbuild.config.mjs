import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prod = process.argv[2] === "production";

// 本机 Obsidian Vault 插件目录：从 deploy-target.json 读取（该文件不进 git，见模板 deploy-target.example.json）
let VAULT_PLUGIN_DIR = "";
try {
  VAULT_PLUGIN_DIR =
    JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-target.json"), "utf8")).vaultPluginDir || "";
} catch {
  /* 未配置部署目标时只构建到仓库根 */
}

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
