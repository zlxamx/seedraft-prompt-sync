# Seedraft Prompt Sync

Obsidian 插件：把 [Seedraft 标准库](https://github.com/zlxamx/Seedraft-Prompt-System) 的更新同步到 Vault 中的各小说项目（B 项目）。

## 工作原理

```text
扫描 Vault 内所有 seedraft-standard.json → B 项目列表
    ↓
查询 A 最新版本（GitHub Release）或导入 ZIP
    ↓
三方判断：B 侧文件未改动 → 直接更新；改动过 → 冲突报告，绝不静默覆盖
    ↓
升级前自动备份到 seedraft-backup/，完成后写升级记录.md
```

## 使用

1. 安装插件（BRAT：添加本仓库，从 Release 安装）。
2. 设置里填 GitHub Token（只需 `repo` 只读权限），标准库仓库默认 `zlxamx/Seedraft-Prompt-System`。
3. 首次使用：运行命令「登记旧项目」，为每个已有小说项目建立版本记录。
4. 打开同步面板（左侧功能区图标或命令），查看可升级项目，点击「升级」。
5. 无网络 / 无 Token：把发布 ZIP 放进 Vault，运行「从 ZIP 导入」。

## 升级保护

- 只处理 A 的 manifest 白名单内的文件；正文、纲目、知识库永不触碰。
- `overwrite` 文件被本地改动过 → 冲突报告，不覆盖。
- `merge` 文件（如 `Gemini.md`）被本地改动过 → 冲突报告（二期做区块合并）。
- 每次升级前自动备份将被修改的文件到 `seedraft-backup/v<旧版本>/`。

## 开发

```bash
npm install
npm run dev    # watch 模式
npm run build  # 类型检查 + 打包 + 部署到本机 Vault
```
