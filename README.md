# 听译 · Translate

Mac 现场韩语识别与中文实时字幕，使用 Soniox `stt-rt-v5`，同一条 WebSocket 返回原文和译文。

## 运行

需要 Node.js 22.12+、npm 和 macOS 麦克风权限。

```sh
npm ci
npm run dev
```

在 [Soniox 控制台](https://console.soniox.com/) 创建具有实时语音识别权限的 API Key，填入应用「服务设置」。只需要一个密钥。可选填写岗位背景与专业术语（每行一个或逗号分隔），下次开始时会作为 Soniox context 发送。默认 `stt-rt-v5` 与中韩 `two_way`，自动识别中韩语并翻成另一种语言，无需手动切换；主界面可切换韩译中 / 中译韩，识别提示与译文目标一起改变。切换会暂停收音，点击继续后使用新方向；已有字幕保留并标记方向。服务费用由你的 Soniox 账户承担。

选择麦克风、确认对方同意云端处理后点击开始。密钥通过 Electron safeStorage 加密保存在本机，不返回界面、不提交仓库；旧版 Deepgram / DeepL 密钥不会用于新连接。

## 字幕和恢复

- 原文与中文随服务返回实时更新，临时内容可能被修订，定稿内容持续保留。
- Soniox 译文没有音频时间戳，因此每次连接按翻译方向分别使用一组连续双语文本，不强行逐句配对。暂停后继续会新增一组。
- 暂停立即停止收音并断开连接，未收到的译文及临时结果可能不完整。已上传内容仍可能在云端处理。
- 断线、上传积压时停止收音并保留当前字幕，点击继续重新连接；中断期间不录音、不补传。
- 清除字幕或关闭窗口会丢弃本次文本。默认不录音。开启「同时录音（本地）」后，每次暂停、切换方向或断线结束一段录音，可试听并手动保存 WebM / Opus 文件。未保存的录音只在内存中，关闭时提醒；清除字幕不会删除录音。只录所选麦克风，不录系统声音，录音不会额外上传。单次保存最大 256 MB，长时间使用请分段保存。云端翻译保留策略取决于供应商。
- 支持韩语输入转中文或中文输入转韩语，未开启说话人区分、语音播报或 AI 回答。

## 验证与构建

```sh
npm test
npm run build
npm run test:ui
npm run package:mac
npm run test:package
```

测试覆盖增量定稿、临时结果替换、译文延后、连接隔离、服务错误、界面、桌面启动及音频采集。真实账户权限、现场韩语准确率、中文自然度和连续 30 分钟稳定性仍需实测。

安装包在 `release/`，为未签名的本地测试版本。

## 架构

React + TypeScript + Vite + Electron。沙盒界面通过限定 IPC 发送单声道 PCM16，主进程管理密钥、Soniox 连接、心跳及背压。

[WebSocket 协议](https://soniox.com/docs/api-reference/stt/websocket-api) · [实时翻译](https://soniox.com/docs/translation/stt-translation/rt-translation)

MIT License.

## 每次打开

安装到「应用程序」后，双击「听译.app」，或用 Spotlight 搜索「听译」。桌面也提供入口。无需终端或 `npm run dev`。API Key 沿用本机加密设置，翻译需要联网。
