# 听译 · Translate

Mac 线下面对面交流的韩语转写与中文实时翻译 MVP。专注于连续字幕、暂停控制与失败恢复，不包含 AI 回答、声纹或个人知识库。

## 运行

需要 Node.js 22.12+、npm，以及 macOS 麦克风权限。

```sh
npm ci
npm run dev
```

启动后打开「服务设置」，填写自己的两项 API 凭据：

- **Deepgram API Key**：Nova-3，韩语 `ko`，通过 WebSocket 流式识别。
- **DeepL API Key**：选择实际的 API Free / API Pro 账户。普通网页翻译订阅不能代替 API 账户。使用 `KO → ZH-HANS`。

API 费用由对应服务账户承担。本项目不会内置共享密钥。留空保存设置会保留已有密钥。服务可用性、现场准确率、费用和端到端延迟需要用实际账户和设备验证；当前没有供应商对比实测。

选择麦克风，确认已获得对方对收音、转写及云端处理的同意，再点击「开始翻译」。首次使用需允许系统麦克风权限。列表尚无设备名称时可先用默认设备，授权后会刷新设备名称。

```sh
npm test             # 队列、定稿去重、取消、重试和 API 错误测试
npm run build        # TypeScript 检查和生产构建
npx playwright install chromium
npm run test:ui      # 浏览器交互、音频采集、Electron 冒烟测试
npm run package:mac  # 在 Mac 构建当前架构的 ZIP
npm run test:package # 验证打包后的 Mac 应用与音频工作线程
```

安装包位于 `release/`。解压后可运行「听译.app」。这是未签名、未公证的本地测试版本；其他 Mac 可能需要在系统「隐私与安全性」允许打开。正式分发需开发者签名、公证及独立设备验证。

## 使用与恢复

- 韩语临时字幕随识别结果更新，定稿片段形成固定行；中文只翻译定稿片段。
- 翻译最多两个并发请求，结果通过片段 ID 更新对应行，不以返回顺序排列。
- 翻译失败保留原文，每行提供「重试翻译」，不需要重新上传音频。
- 暂停会关闭麦克风、断开识别连接、取消客户端翻译请求。已上传的数据可能仍在服务端处理。未定稿内容会丢弃。
- 断网、设备断开或上传积压时暂停，保留已确认字幕。恢复后手动点击继续；断开期间不录音、不补传。恢复连接不会自动录音。
- 清除字幕会先暂停并取消旧任务。关闭窗口清空字幕；没有会话落盘或后台收音。
- 暂不区分说话人，也不识别中文输入。请尽量轮流说话，避免双人同时讲话。
- 「最近翻译耗时」仅测量定稿片段发起翻译到收到译文的时间，不包含收音、识别和排队等待，不能视为端到端延迟。

## 架构

```text
Renderer: 麦克风 → AudioWorklet → 单声道 PCM16
                         ↓ 限定 IPC
Electron main: Deepgram WebSocket → 临时字幕 / 定稿字幕
                                       ↓
                            有界翻译队列 → DeepL
                                       ↓
Renderer:                       按片段 ID 配对显示
```

前端：React + TypeScript + Vite。桌面：Electron，开启上下文隔离和沙盒，关闭 Node 集成；主进程负责服务连接和密钥，preload 只暴露限定功能。无独立服务端、数据库或复杂 Agent 框架。

密钥由 Electron `safeStorage` 加密后写入应用用户数据目录的 `credentials.enc`；macOS 使用系统钥匙串提供的加密能力。UI 只接收是否已配置的状态，保存后不回传明文密钥。系统安全存储不可用时拒绝保存。

音频仅在内存缓冲并发送到 Deepgram；韩语定稿发送到 DeepL。程序不保存录音或转写文件。服务端保留策略由对应供应商和账户设置决定，不等同于本机不保存。

## 验证边界

自动化测试覆盖片段乱序、重复定稿、暂停与清除取消、翻译重试、API 认证及额度错误、界面操作、PCM 音频采集和桌面启动。

以下仍需实测，不能以自动化通过代替：

- 实际 API 密钥的账户权限与网络可达性。
- 非母语韩语、远场麦克风、噪声与交叉发言的识别和翻译质量。
- 真实双人连续 30 分钟运行、端到端字幕延迟。
- 不同 Mac 设备的权限、休眠恢复和安装包启动。

## 接口依据

- [Deepgram 模型与语言](https://developers.deepgram.com/docs/models-languages-overview)
- [Deepgram 流式识别](https://developers.deepgram.com/reference/speech-to-text/listen-streaming)
- [Deepgram 临时与最终结果](https://developers.deepgram.com/docs/understand-endpointing-interim-results)
- [DeepL 文本翻译 API](https://developers.deepl.com/api-reference/translate/request-translation)

MIT License.
