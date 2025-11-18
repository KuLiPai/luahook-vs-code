# LuaHook VS Code Extension

**🚀 极速、轻量、现代化的 LuaHook 脚本开发辅助插件**

👉 **LuaHook 项目地址（GitHub）**
[https://github.com/KuLiPai/LuaHook](https://github.com/KuLiPai/LuaHook)

本扩展是 LuaHook 的 VS Code 辅助开发插件，能够：

* 自动管理 LuaHook 脚本
* 一键同步脚本并重启目标 App
* 实时查看 LuaHook 日志
* 提供不完整的 API 自动补全支持

从写代码 → 生效只需要 **1 秒钟**。
比 Frida / Xposed 的调试效率更高、更丝滑。

---

# ⚠️ 使用前请务必阅读：运行环境要求（非常重要）

### ✔ 必须满足

1. **电脑可执行 adb 且已加入系统 PATH**

   ```bash
   adb devices
   ```

   能输出设备即正常。

2. **手机安装并启用了 LuaHook**

3. **LuaHook作用域已勾选目标应用（可选创建脚本）**

4. **手机连接电脑，开启开发者模式 + USB 调试**

5. **被 Hook 的 App 已被框架注入（如 LSPosed，LSPatch）**

---

### ✔ 无 Root 也能使用

插件会自动以普通 adb push 推送脚本。

---

### ⚠️ 若你手机有 ROOT，必须满足以下条件才能正常使用：

插件在检测到 push 权限不足时，会自动启用 **su -c** 的 Root 推送模式。

❗**你的 su 必须支持 `su -c` 命令执行**
部分魔改系统会屏蔽。

测试方法（必须能输出 OK）：

```bash
adb shell su -c "echo OK"
```

如果不输出任何内容（如直接空行），说明：

✔ 你有 root
✘ 但 shell 权限没有 root
✘ 或 su 不支持标准 -c 语法

本插件依赖标准 su -c，否则脚本无法被写入 /data/local/tmp。

---

# ✨ 功能特性（Features）

## 🗂 1. LuaHook 脚本树（TreeView）

* 自动读取 LuaHook 的 apps.txt
* 按 App 分类展示脚本
* 点击脚本可直接打开 `.lua` 文件

## 🔧 2. 可视化脚本配置编辑

包含：

* 是否启用（enabled）
* 脚本描述（desc）
* 版本号（version）

自动写入 JSON 并同步推送到设备。

## 🚀 3. 一键运行（Run Hook）

点击一次即可：

1. push（或 su push）脚本到设备
2. 自动修复文件权限
3. 自动重启目标应用
4. 自动打开实时日志

开发体验真正做到 **一键生效**。

## 📡 4. 实时 Logcat（LuaXposed:*）

* 自动打开终端
* 自动清日志
* 支持 streaming 模式（实时输出）
* App 重启后自动保持观察

## 🧩 5. 超强 Lua 智能补全（IntelliSense）

包括：

### Hook 相关

* hook / hookAll / hookctor / replace 代码片段
* 新语法 table 属性补全（class / method / params / before / after）
* it.* 提示（args / thisObject / result / method）

### LuaHook 全局 API

* lpparam.*
* suparam.*
* http / file / native / DexKitBridge / DexFinder / resources / sp …

### 其他

* 自动插入：

  ```
  ---@diagnostic disable: undefined-global
  ```

  暂时彻底解决 Lua 语言服务器的全局变量警告。

## ➕ 6. 右键创建脚本

* 在 APP 节点右键 → **新建脚本**
* 自动生成模板
* 自动写入配置 JSON
* 自动 push 到设备

实现 **零成本创建新 Hook 脚本**。

---

# 🔗 关于 LuaHook

LuaHook 是由 **KuLiPai** 开发的一款 Android Lua Hook 框架。
通过 Lua 脚本即可完成 Java 方法 Hook、构造函数 Hook、替换等功能。

项目地址：
👉 [https://github.com/KuLiPai/LuaHook](https://github.com/KuLiPai/LuaHook)

本扩展是 LuaHook 的配套工具，但 LuaHook 本身**不依赖**本插件。

---

# ❤️ 关于本插件的开发

本插件由 **ChatGPT（GPT-5.1）全程辅助完成**。

---

# 🪪 License

本项目使用 **MIT License**
允许二次开发、商业使用、修改与分发。

---

# 📥 安装方法

### ✔ VS Code 插件市场搜索：

```
LuaHook VS Code
```

### ✔ 或使用离线 VSIX 包：

```
vsce package
code --install-extension luahook-vs-code-*.vsix
```

---

# 🎉 最后

如果你正在使用 LuaHook，那么这个插件会让你得到：

✔ 快速调试
✔ 极速热更新
✔ 自动日志
✔ 极简操作
✔ 远超 Frida 的 Hook 流程速度

这是一次 Hook 调试体验的全面升级。

欢迎给项目点 ⭐，也欢迎反馈建议！
