# UFI Tools sing-box 管理插件

`singbox-plugin.js` 是根据提供的 Mihomo/Clash 插件重写的 sing-box 版本，适用于能够调用 `runShellWithRoot`、`createToast`、`createFixedToast`、`collapseGen` 的 UFI Tools/F50 管理页面。

## 功能

- 从 sing-box 官方 GitHub Release 安装或更新最新稳定版，并结合 `uname` 与 Android `getprop` 自动识别 `arm64-v8a`、`armeabi-v7a`、`armv8l`、`arm64`、`armv7`、`amd64` 和 `386`。下载 Android CLI 构建，而不是无法在 Android 上加载的 Linux ELF。
- 启动、停止、重启、状态检测、三击卸载和开机自启。
- 在线编辑、上传、备份 JSON 配置；保存前运行 `sing-box check`，失败时不覆盖旧配置。
- 查看、自动刷新、清空和下载日志。
- 上传自定义 ELF 内核；替换前先执行 `sing-box version` 验证。
- 默认开放 Mixed 入站 `0.0.0.0:2080` 和 Clash API/面板 `0.0.0.0:9090`。
- 支持 Android 路由设备的 TProxy 透明代理，可与 Mihomo 同类用法衔接。
- 保存两个 sing-box/通用订阅地址并一键更新；自动下载、解析、合并节点和选择器。
- 更新配置前自动备份并执行 `sing-box check`，重启失败时恢复上一份配置。

## 使用

把 `singbox-plugin.js` 作为 UFI Tools 自定义插件加载。首次进入 sing-box 折叠面板后点击“安装/在线更新”。

初始配置只使用 `direct` 出站，目的是保证内核能够成功启动，不会自动提供代理能力。安装后请通过“编辑配置”或“上传配置”替换为自己的完整 sing-box JSON，也可以在订阅区保存订阅地址并执行一键更新。面板 API 密钥会在首次安装完成提示中显示，也可以在 `/data/sing-box/config/config.json` 的 `experimental.clash_api.secret` 查看。

设备需要：root、高级功能、可用的 `tar`/`find`/`nohup` 命令，以及原 UFI Tools 附带的 `curl`：

```text
/data/data/com.minikano.f50_sms/files/curl
```

主要路径：

```text
/data/sing-box/bin/sing-box
/data/sing-box/config/config.json
/data/sing-box/scripts/sing-box.service
/sdcard/sing-box内核日志.txt
```

> 默认配置不会自动接管路由器流量。透明代理所需的 TProxy 入站、DNS、策略路由和防火墙规则与设备固件相关；仓库中的 `sing-box.service` 提供了当前设备使用的服务脚本参考。

## 隐私提醒

订阅地址、节点 UUID/密码和面板密钥都属于敏感信息。仓库已忽略本地生成的 `sing-box-config.json` 和订阅临时文件，请不要手动提交它们。
