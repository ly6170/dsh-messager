# dsh-messager

[简体中文](README.md) | [English](README.en.md)

DeepSeek Harness（DSH）的任务通知插件。会话需要审批、提问或计划审核，任务完成或出错时，可发送系统通知、浏览器通知，以及飞书、企业微信、Discord、钉钉、Telegram 消息。

## 兼容版本

**v0.3.5 支持 DSH `0.2.0-rc.1` 及兼容的后续 0.2.x 版本。** 使用 DSH 0.1.x 请保留对应的旧版插件。升级到 DSH 0.2.x 后再安装本版本；现有通知配置无需迁移。

## 安装

**DSH 桌面版：**点击左上角「插件」→「添加插件」，输入 `dsh-messager` 并安装。安装后重启 DSH。

**命令行版（npm 包）：**需要 Node.js 20+、pnpm 和 DSH CLI。将包安装到 Web profile：

```sh
dsh plugin --profile web add dsh-messager
dsh web
```

如果从 DSH 源码仓库运行，将 `dsh` 换为 `pnpm dsh`。安装后若 DSH 已在运行，请重启。

**从源码安装**（开发者可选）：

```sh
git clone https://github.com/ly6170/dsh-messager.git
cd dsh-messager
pnpm install
pnpm build
dsh plugin --profile web add .
dsh web
```

## 使用

打开 DSH 设置页的「通知&信使」分区，选择触发时机、启用通道并填写对应的 webhook 或 Bot 信息，然后保存。系统通知和浏览器通知默认开启；第三方通道默认关闭。浏览器通知还需要授予站点通知权限。

通知只针对需要交互、根会话任务完成和任务出错；运行中的蓝色状态不会触发通知。配置修改保存后即可生效。

## 常见问题

- **设置分区未出现或配置路由返回 404**：检查插件是否安装到当前使用的 `web` profile、DSH 是否已重启，以及 DSH 与插件版本是否兼容。
- **浏览器通知未出现**：检查站点通知权限；默认仅在页面隐藏或失焦时发送。
- **用 `--patch` 调试时设置不可用**：该模式只加载 host 端。要使用设置页，请通过 `dsh plugin add` 安装。

[v0.3.5 更新说明](RELEASE_NOTES_v0.3.5.md) · [English](README.en.md) · [MIT License](LICENSE)
