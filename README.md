# 适配中兴随身 WiFi 的 sing-box 插件（UFI Tools）

这是一个面向兼容 **UFI Tools** 管理环境的第三方 sing-box 管理与 TProxy 插件。目前主要按中兴 F50 的 UFI Tools 环境编写；其他中兴随身 WiFi 型号、固件和 UFI Tools 版本尚未逐一验证。

> 本项目是社区维护的非官方项目，与中兴通讯、UFI Tools、Minikano、SagerNet 或 sing-box 项目不存在隶属、授权、赞助或背书关系。产品名和商标仅用于说明兼容对象，权利归各自权利人所有。

## 功能

- 从 [SagerNet/sing-box](https://github.com/SagerNet/sing-box) 官方 GitHub Release 安装或更新 Android CLI 构建，并根据设备架构选择下载包。
- 启动、停止、重启、状态检测、卸载和开机自启。
- 在线编辑、上传、备份和校验 JSON 配置；配置无效时不覆盖旧配置。
- 查看、刷新、清空和下载运行日志。
- 上传自定义 sing-box 可执行文件，并在替换前执行版本检查。
- 支持 Android 路由设备上的 TProxy 透明代理和 DNS 劫持规则。
- 保存两个 sing-box/通用订阅地址，合并节点与选择器，并在更新失败时回滚。
- 可生成 Mixed 入站和 Clash API 配置。

## 兼容性与前提

设备至少需要：

- 已获取 root 权限并启用 UFI Tools 高级功能；
- 管理页面提供 `runShellWithRoot`、`createToast`、`createFixedToast`、`collapseGen` 等插件 API；
- 系统有可用的 `tar`、`find`、`nohup`、`iptables`、`ip rule` 等命令；
- UFI Tools 附带的 `curl` 位于以下路径：

```text
/data/data/com.minikano.f50_sms/files/curl
```

当前服务脚本默认使用 `br0` 作为 LAN 接口。不同固件的接口名、iptables 实现和策略路由能力可能不同，使用前请核对 [`sing-box.service`](./sing-box.service) 顶部变量。

## 安装

1. 下载 [`singbox-plugin.js`](./singbox-plugin.js)。
2. 在 UFI Tools 的自定义插件页面加载该文件。
3. 打开 sing-box 折叠面板，点击“安装 / 在线更新”。
4. 首次启动前上传自己的完整 sing-box JSON 配置，或在订阅区保存订阅并执行更新。
5. 确认 `sing-box check` 通过后再启用服务或开机自启。

初始配置只提供 `direct` 出站，用于确认内核能够启动，不会自动提供可用的代理节点。

主要运行路径：

```text
/data/sing-box/bin/sing-box
/data/sing-box/config/config.json
/data/sing-box/config/subscriptions.json
/data/sing-box/scripts/sing-box.service
/sdcard/sing-box内核日志.txt
```

## 安全提示

- 订阅地址、节点 UUID/密码、面板密钥和日志可能包含敏感信息，禁止提交到公开仓库或 Issue。
- 生成的 Mixed 入站（默认 `7890`）和 Clash API（默认 `9090`）监听 `0.0.0.0`。这意味着同一网络内其他设备也可能访问；不要把对应端口暴露到公网，并设置强密钥和防火墙限制。
- TProxy 会修改 iptables、策略路由和 DNS 流量。首次使用前请保留可用的设备管理通道和配置备份。
- 安装器会从 GitHub 下载可执行文件。高安全要求场景应自行核验 Release 来源、校验值和二进制版本。
- 自定义配置可能导致断网、循环代理或 DNS 故障。此项目不保证适配所有设备和固件。

安全问题请按 [`SECURITY.md`](./SECURITY.md) 处理，不要公开粘贴凭据。

## 来源、致谢与许可证

- 插件运行环境及部分交互 API 来自 [Minikano 的 UFI-TOOLS](https://github.com/kanoqwq/UFI-TOOLS)，该项目采用 MIT License。
- sing-box 内核来自 [SagerNet/sing-box](https://github.com/SagerNet/sing-box)。本仓库不包含该内核，只在用户操作后从其官方 Release 下载；下载的二进制继续服从 sing-box 自身许可证。
- 本插件曾参考维护者收到的一份 Mihomo/Clash UFI Tools 插件重新实现。该参考插件目前没有可核实的公开仓库、作者和许可证链接，因此本仓库不声称拥有或重新授权其中可能存在的第三方权利。如你是原作者或能提供可靠来源，请提交 Issue；维护者会补充署名、遵守许可要求，或移除有争议的内容。

详细说明见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。[`LICENSE`](./LICENSE) 中的 MIT 许可仅适用于 `wl77vv` 拥有版权的原创及修改部分；第三方项目、名称、商标和二进制不因此被重新许可。

## 免责声明

本项目按“现状”提供，不附带任何明示或默示保证。刷机、root、网络规则修改和第三方二进制运行均可能造成断网、数据丢失、设备故障或安全风险，使用者自行评估并承担风险。本文不是法律意见；如果要商业分发或预装，请自行完成许可证与商标合规审查。
