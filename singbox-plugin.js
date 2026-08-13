// Unofficial sing-box plugin for compatible ZTE UFI Tools environments.
// Attribution, licensing, and safety notes: README.md and THIRD_PARTY_NOTICES.md.
//<script>
(() => {
  'use strict';

  const ROOT = '/data/sing-box';
  const BIN = `${ROOT}/bin/sing-box`;
  const CONFIG = `${ROOT}/config/config.json`;
  const SUB_CONFIG = `${ROOT}/config/subscriptions.json`;
  const SUB_DIR = `${ROOT}/subscriptions`;
  const SERVICE = `${ROOT}/scripts/sing-box.service`;
  const LOG = '/sdcard/sing-box内核日志.txt';
  const INSTALL_LOG = '/sdcard/sing-box安装日志.txt';
  const BOOT = '/sdcard/ufi_tools_boot.sh';
  const CURL = '/data/data/com.minikano.f50_sms/files/curl';
  const UPLOAD_ROOT = '/data/data/com.minikano.f50_sms/files';
  const API_PORT = 9090;
  const PLUGIN_VERSION = '2.4.0-subscriptions';

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomString = (length = 16) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let i = 0; i < length; i++) value += chars[Math.floor(Math.random() * chars.length)];
    return value;
  };
  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const shQuote = (value = '') => `'${String(value).replaceAll("'", `'"'"'`)}'`;
  const shell = (command, timeout = 100000) => runShellWithRoot(command, timeout);
  const utf8ToBase64 = (value) => {
    const bytes = new TextEncoder().encode(value);
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const base64ToUtf8 = (value) => {
    const normalized = value.replace(/\s+/g, '').replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  };

  const requireRoot = async () => {
    const res = await shell('whoami');
    if (res.success && /^root$/m.test((res.content || '').trim())) return true;
    createToast('没有开启高级功能或未取得 root 权限。', 'red');
    return false;
  };
  const isInstalled = async () => {
    const res = await shell(`test -x ${BIN} && test -x ${SERVICE} && echo installed`);
    return !!(res.success && (res.content || '').includes('installed'));
  };
  const isRunning = async () => {
    const res = await shell(`if test -f ${ROOT}/run/sing-box.pid && kill -0 $(cat ${ROOT}/run/sing-box.pid) 2>/dev/null; then echo running; fi`);
    const running = !!(res.content || '').includes('running');
    const label = document.querySelector('#running_singbox');
    if (label) label.textContent = running ? 'sing-box - 🟢运行中' : 'sing-box - 🔴已停止';
    return running;
  };
  const isBootEnabled = async () => {
    const res = await shell(`grep -qF '${SERVICE} start' ${BOOT} 2>/dev/null; echo $?`);
    return (res.content || '').trim().split(/\s+/).pop() === '0';
  };
  const refreshBootButton = async () => {
    const button = document.querySelector('#singbox_boot');
    if (button) button.style.background = (await isBootEnabled()) ? 'var(--dark-btn-color-active)' : '';
  };
  const confirmDialog = (id, title, body, ok = '确认', cancel = '取消') => new Promise((resolve) => {
    const { el, close } = createFixedToast(id, `
      <div style="pointer-events:all;width:90vw;max-width:560px">
        <div class="title" style="margin:0">${escapeHtml(title)}</div>
        <div style="margin-top:10px;font-size:.7rem;line-height:1.75">${body}</div>
        <div style="margin-top:14px;text-align:right;display:flex;justify-content:flex-end;gap:10px">
          <button class="ok">${escapeHtml(ok)}</button><button class="cancel">${escapeHtml(cancel)}</button>
        </div>
      </div>`);
    const done = (answer) => { close(); resolve(answer); };
    el.querySelector('.ok').onclick = () => done(true);
    el.querySelector('.cancel').onclick = () => done(false);
  });

  const showLog = (initial = '') => {
    let timer = null;
    let autoScroll = true;
    const id = `singbox_log_${randomString(5)}`;
    const { el, close } = createFixedToast(id, `
      <div style="pointer-events:all;width:86vw;max-width:850px">
        <div class="title" style="margin:0">sing-box 日志（最后 200 行）</div>
        <pre class="log" style="background:#000d;color:#0f0;box-sizing:border-box;line-height:1.4;margin:10px 0;padding:8px;max-height:430px;overflow:auto;font-size:.64rem;white-space:pre-wrap">${escapeHtml(initial)}</pre>
        <div style="text-align:right;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="download">下载</button><button class="scroll">暂停滚动</button>
          <button class="refresh">刷新</button><button class="clear">清空</button><button class="close">关闭</button>
        </div>
      </div>`);
    const logEl = el.querySelector('.log');
    const refresh = async (notify = false) => {
      const res = await shell(`tail -n 200 ${shQuote(LOG)} 2>/dev/null`);
      logEl.textContent = res.content || '(暂无日志)';
      if (autoScroll) logEl.scrollTop = logEl.scrollHeight;
      if (notify) createToast('日志已刷新', 'green');
    };
    el.querySelector('.refresh').onclick = () => refresh(true);
    el.querySelector('.clear').onclick = async () => {
      const res = await shell(`: > ${shQuote(LOG)}`);
      if (res.success) { logEl.textContent = ''; createToast('日志已清空', 'green'); }
    };
    el.querySelector('.scroll').onclick = (event) => {
      autoScroll = !autoScroll;
      event.target.textContent = autoScroll ? '暂停滚动' : '自动滚动';
    };
    el.querySelector('.download').onclick = () => {
      const blob = new Blob([logEl.textContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = `sing-box-log-${Date.now()}.txt`; a.href = url; a.click();
      URL.revokeObjectURL(url);
    };
    el.querySelector('.close').onclick = () => { if (timer) clearInterval(timer); close(); };
    refresh();
    timer = setInterval(refresh, 1500);
  };

  const restart = async (quiet = false) => {
    if (!(await requireRoot()) || !(await isInstalled())) return false;
    if (!quiet) createToast('正在校验配置并重启 sing-box…');
    const res = await shell(`${BIN} check -c ${CONFIG} && ${SERVICE} restart`, 120000);
    if (!res.success) { createToast(`重启失败：<br>${escapeHtml(res.content || '请查看日志')}`, 'red'); return false; }
    await wait(1500); await isRunning();
    if (!quiet) createToast('sing-box 已重启', 'green');
    return true;
  };

  const saveUploadedConfig = async (file) => {
    const formData = new FormData(); formData.append('file', file);
    try {
      const response = await fetch(`${KANO_baseURL}/upload_img`, { method: 'POST', headers: common_headers, body: formData });
      const data = await response.json();
      if (!data.url || !/^[A-Za-z0-9_./-]+$/.test(data.url)) throw new Error(data.error || '上传接口未返回有效路径');
      const source = `${UPLOAD_ROOT}/${data.url.replace(/^\/+/, '')}`;
      const candidate = `${ROOT}/config/config.candidate.json`;
      const res = await shell(`
        mv ${shQuote(source)} ${candidate} || exit 1
        chmod 600 ${candidate}
        ${BIN} check -c ${candidate} || { rm -f ${candidate}; exit 2; }
        cp ${CONFIG} ${CONFIG}.bak 2>/dev/null || true
        mv ${candidate} ${CONFIG}
        ${SERVICE} restart
      `, 120000);
      if (!res.success) throw new Error(res.content || '配置校验或重启失败');
      createToast('配置已通过校验并生效', 'green'); await wait(1000); await isRunning(); return true;
    } catch (error) {
      createToast(`保存失败，旧配置未被覆盖：<br>${escapeHtml(error.message || error)}`, 'red'); return false;
    }
  };

  const prefixProviderOutbounds = (source, prefix) => {
    const outbounds = Array.isArray(source?.outbounds) ? source.outbounds : [];
    const tags = new Set(outbounds.map((item) => item?.tag).filter(Boolean));
    const prefixed = (tag) => tags.has(tag) ? `${prefix}${tag}` : tag;
    return outbounds.map((item) => {
      const next = structuredClone(item);
      next.tag = `${prefix}${item.tag}`;
      if (Array.isArray(next.outbounds)) next.outbounds = next.outbounds.map(prefixed);
      if (next.default) next.default = prefixed(next.default);
      if (next.detour) next.detour = prefixed(next.detour);
      return next;
    });
  };

  const uniqueTag = (base, used) => {
    let tag = base || '未命名节点'; let index = 2;
    while (used.has(tag)) tag = `${base || '未命名节点'}-${index++}`;
    used.add(tag); return tag;
  };

  const parseXueShanSubscription = (encoded) => {
    const decoded = base64ToUtf8(encoded);
    const used = new Set(); const nodes = [];
    for (const rawLine of decoded.split(/\r?\n/)) {
      const line = rawLine.trim(); if (!line) continue;
      let url;
      try { url = new URL(line); } catch { throw new Error('雪山订阅包含无法解析的节点链接'); }
      const scheme = url.protocol.replace(':', '').toLowerCase();
      if (!['vless', 'hysteria2', 'hy2'].includes(scheme)) throw new Error(`雪山订阅出现暂不支持的协议：${scheme}`);
      const name = decodeURIComponent(url.hash.slice(1)) || `${scheme}-${nodes.length + 1}`;
      const tag = uniqueTag(`XueShan/${name}`, used);
      const server = url.hostname.replace(/^\[|\]$/g, '');
      const serverPort = Number(url.port);
      if (!server || !serverPort) throw new Error(`雪山节点缺少服务器或端口：${name}`);
      const query = url.searchParams;
      if (scheme === 'hysteria2' || scheme === 'hy2') {
        const tls = { enabled: true };
        const serverName = query.get('sni') || query.get('servername');
        if (serverName) tls.server_name = serverName;
        tls.insecure = ['1', 'true'].includes((query.get('insecure') || '').toLowerCase());
        nodes.push({
          type: 'hysteria2', tag, server, server_port: serverPort,
          password: decodeURIComponent(url.username), up_mbps: 3000, down_mbps: 3000, tls,
        });
        continue;
      }
      const security = (query.get('security') || '').toLowerCase();
      const tls = { enabled: security === 'tls' || security === 'reality' };
      const serverName = query.get('sni') || query.get('servername');
      if (serverName) tls.server_name = serverName;
      tls.insecure = ['1', 'true'].includes((query.get('insecure') || '').toLowerCase());
      const fingerprint = query.get('fp');
      if (fingerprint) tls.utls = { enabled: true, fingerprint };
      if (security === 'reality') {
        tls.reality = { enabled: true, public_key: query.get('pbk'), short_id: query.get('sid') || null };
        if (!tls.reality.public_key) throw new Error(`Reality 节点缺少公钥：${name}`);
      }
      const node = {
        type: 'vless', tag, server, server_port: serverPort,
        uuid: decodeURIComponent(url.username), packet_encoding: 'xudp', tls,
      };
      if (query.get('flow')) node.flow = query.get('flow');
      nodes.push(node);
    }
    if (!nodes.length) throw new Error('雪山订阅没有可用节点');
    const nodeTags = nodes.map((node) => node.tag);
    return [
      { type: 'selector', tag: 'XueShan/节点选择', outbounds: ['XueShan/自动选择', ...nodeTags], default: 'XueShan/自动选择' },
      { type: 'urltest', tag: 'XueShan/自动选择', outbounds: nodeTags },
      ...nodes,
    ];
  };

  const readSubscriptions = async () => {
    const res = await shell(`test -f ${SUB_CONFIG} && cat ${SUB_CONFIG} || echo '{}'`);
    try { return JSON.parse(res.content || '{}'); } catch { throw new Error('订阅设置文件损坏'); }
  };

  const saveSubscriptions = async (subscriptions) => {
    const encoded = utf8ToBase64(JSON.stringify(subscriptions, null, 2));
    const res = await shell(`mkdir -p ${SUB_DIR}; echo ${shQuote(encoded)} | base64 -d > ${SUB_CONFIG} && chmod 600 ${SUB_CONFIG}`);
    if (!res.success) throw new Error(res.content || '保存订阅设置失败');
  };

  const editSubscriptions = async () => {
    if (!(await requireRoot()) || !(await isInstalled())) return;
    let current;
    try { current = await readSubscriptions(); } catch (error) { return createToast(escapeHtml(error.message), 'red'); }
    const { el, close } = createFixedToast('singbox_subscriptions', `
      <div style="pointer-events:all;width:88vw;max-width:720px">
        <div class="title" style="margin:0">订阅设置</div>
        <label style="display:block;margin-top:12px">GLaDOS 原生 sing-box 订阅</label>
        <input class="glados" type="url" style="width:100%;box-sizing:border-box" placeholder="https://...">
        <label style="display:block;margin-top:12px">雪山订阅</label>
        <input class="xueshan" type="url" style="width:100%;box-sizing:border-box" placeholder="https://...">
        <div style="margin-top:12px;font-size:.62rem;opacity:.8">订阅地址仅保存在设备 ${SUB_CONFIG}</div>
        <div style="margin-top:14px;text-align:right"><button class="save">保存</button> <button class="cancel">取消</button></div>
      </div>`);
    el.querySelector('.glados').value = current.glados || '';
    el.querySelector('.xueshan').value = current.xueshan || '';
    el.querySelector('.cancel').onclick = close;
    el.querySelector('.save').onclick = async () => {
      const subscriptions = { glados: el.querySelector('.glados').value.trim(), xueshan: el.querySelector('.xueshan').value.trim() };
      try {
        for (const [name, value] of Object.entries(subscriptions)) {
          const url = new URL(value); if (url.protocol !== 'https:') throw new Error(`${name} 必须是 HTTPS 地址`);
        }
        await saveSubscriptions(subscriptions); close(); createToast('订阅设置已保存', 'green');
      } catch (error) { createToast(escapeHtml(error.message || error), 'red'); }
    };
  };

  const updateSubscriptions = async () => {
    if (!(await requireRoot()) || !(await isInstalled())) return;
    const progress = createFixedToast('singbox_subscription_update', `
      <div style="pointer-events:all;width:82vw;max-width:520px">
        <div class="title" style="margin:0">更新 sing-box 订阅</div>
        <div class="status" style="margin:12px 0">正在读取订阅设置…</div>
        <div style="height:10px;background:#ffffff22;border-radius:8px;overflow:hidden"><div class="bar" style="height:100%;width:8%;background:#35c46a;transition:width .4s"></div></div>
        <div class="detail" style="margin-top:8px;font-size:.62rem;opacity:.8">更新前会自动备份，校验失败不会覆盖旧配置</div>
      </div>`);
    const setProgress = (percent, status) => { progress.el.querySelector('.bar').style.width = `${percent}%`; progress.el.querySelector('.status').textContent = status; };
    try {
      const subscriptions = await readSubscriptions();
      if (!subscriptions.glados || !subscriptions.xueshan) throw new Error('请先打开“订阅设置”填写两个订阅地址');
      const gladosUrl = new URL(subscriptions.glados); gladosUrl.hash = '';
      const xueshanUrl = new URL(subscriptions.xueshan); xueshanUrl.hash = '';
      if (gladosUrl.protocol !== 'https:' || xueshanUrl.protocol !== 'https:') throw new Error('订阅地址必须使用 HTTPS');
      setProgress(20, '正在下载 GLaDOS 和雪山订阅…');
      const download = await shell(`
        mkdir -p ${SUB_DIR}
        rm -f ${SUB_DIR}/glados.raw ${SUB_DIR}/xueshan.raw
        download_sub() { URL="$1"; OUTPUT="$2"; ${CURL} -fsSL --connect-timeout 15 --max-time 90 "$URL" -o "$OUTPUT" || ${CURL} -fsSL --connect-timeout 15 --max-time 90 -x http://127.0.0.1:7890 "$URL" -o "$OUTPUT"; }
        download_sub ${shQuote(gladosUrl.href)} ${SUB_DIR}/glados.raw || exit 11
        download_sub ${shQuote(xueshanUrl.href)} ${SUB_DIR}/xueshan.raw || exit 12
        test -s ${SUB_DIR}/glados.raw && test -s ${SUB_DIR}/xueshan.raw || exit 13
        printf 'G='; base64 ${SUB_DIR}/glados.raw | tr -d '\\n'; printf '\\nX='; base64 ${SUB_DIR}/xueshan.raw | tr -d '\\n'; printf '\\n'
      `, 220000);
      if (!download.success) throw new Error(`下载订阅失败：${download.content || '请检查网络和订阅地址'}`);
      const gladosEncoded = (download.content.match(/(?:^|\n)G=([^\n]+)/) || [])[1];
      const xueshanEncoded = (download.content.match(/(?:^|\n)X=([^\n]+)/) || [])[1];
      if (!gladosEncoded || !xueshanEncoded) throw new Error('订阅下载结果不完整');
      setProgress(45, '正在转换节点格式…');
      const gladosRaw = JSON.parse(base64ToUtf8(gladosEncoded));
      const gladosSource = Array.isArray(gladosRaw) ? gladosRaw[0] : gladosRaw;
      const gladosOutbounds = prefixProviderOutbounds(gladosSource, 'GLaDOS/');
      if (!gladosOutbounds.length) throw new Error('GLaDOS 订阅没有 outbounds');
      const xueshanOutbounds = parseXueShanSubscription(base64ToUtf8(xueshanEncoded));
      const configResult = await shell(`cat ${CONFIG}`);
      if (!configResult.success) throw new Error('无法读取当前配置');
      const config = JSON.parse(configResult.content);
      if (!Array.isArray(config.outbounds)) throw new Error('当前配置缺少 outbounds');
      const preserved = config.outbounds.filter((outbound) => !String(outbound.tag || '').startsWith('GLaDOS/') && !String(outbound.tag || '').startsWith('XueShan/'));
      config.outbounds = [...preserved, ...gladosOutbounds, ...xueshanOutbounds];
      setProgress(70, `已转换 GLaDOS ${gladosOutbounds.length} 项、雪山 ${xueshanOutbounds.length - 2} 个节点，正在校验…`);
      const candidate = new File([JSON.stringify(config, null, 2)], 'config.json', { type: 'application/json' });
      const saved = await saveUploadedConfig(candidate);
      if (!saved) throw new Error('新配置校验或重启失败，旧配置已保留');
      setProgress(100, '订阅更新成功'); await wait(700); progress.close();
      createToast(`订阅更新完成：GLaDOS ${gladosOutbounds.length} 项，雪山 ${xueshanOutbounds.length - 2} 个节点`, 'green');
    } catch (error) {
      progress.close(); createToast(`订阅更新失败：<br>${escapeHtml(error.message || error)}`, 'red');
    }
  };

  const installOrUpdate = async () => {
    if (!(await requireRoot())) return;
    const installed = await isInstalled();
    const secret = randomString(24);
    const progress = createFixedToast(
      'singbox_install_progress',
      `<div style="pointer-events:all;width:82vw;max-width:520px">
        <div class="title" style="margin:0">sing-box 安装器 ${PLUGIN_VERSION}</div>
        <div class="status" style="margin:12px 0 8px">正在获取版本信息…</div>
        <div style="height:10px;background:#ffffff22;border-radius:8px;overflow:hidden">
          <div class="bar" style="height:100%;width:8%;background:#35c46a;border-radius:8px;transition:width .8s"></div>
        </div>
        <div class="detail" style="margin-top:8px;font-size:.62rem;opacity:.8">请勿关闭页面</div>
      </div>`,
      '',
    );
    let elapsed = 0;
    const progressTimer = setInterval(() => {
      elapsed += 1;
      const bar = progress.el.querySelector('.bar');
      const status = progress.el.querySelector('.status');
      const detail = progress.el.querySelector('.detail');
      if (bar) bar.style.width = `${8 + ((elapsed * 7) % 84)}%`;
      if (status) status.textContent = '正在下载并安装 Android 内核…';
      if (detail) detail.textContent = `已等待 ${elapsed} 秒；安装日志：${INSTALL_LOG}`;
    }, 1000);
    const defaultConfig = JSON.stringify({
      log: { level: 'info', timestamp: true },
      dns: {
        servers: [{ type: 'udp', tag: 'dns-direct', server: '223.5.5.5', server_port: 53 }],
        final: 'dns-direct', strategy: 'ipv4_only',
      },
      inbounds: [
        { type: 'mixed', tag: 'mixed-in', listen: '0.0.0.0', listen_port: 7890 },
        { type: 'direct', tag: 'dns-in', listen: '0.0.0.0', listen_port: 1053 },
        { type: 'tproxy', tag: 'tproxy-in', listen: '0.0.0.0', listen_port: 7893 },
      ],
      outbounds: [{ type: 'direct', tag: 'DIRECT' }],
      route: {
        rules: [
          { inbound: ['tproxy-in', 'mixed-in'], action: 'sniff', timeout: '1s' },
          { inbound: ['dns-in'], action: 'hijack-dns' },
          { protocol: 'dns', action: 'hijack-dns' },
        ],
        final: 'DIRECT', auto_detect_interface: true, default_domain_resolver: 'dns-direct',
      },
      experimental: {
        cache_file: { enabled: true, path: `${ROOT}/cache.db` },
        clash_api: { external_controller: `0.0.0.0:${API_PORT}`, external_ui: `${ROOT}/dashboard`, secret },
      },
    }, null, 2);
    const res = await shell(`
      mkdir -p ${ROOT}/bin ${ROOT}/config ${ROOT}/scripts ${ROOT}/run ${ROOT}/tmp ${SUB_DIR}
      set -e
      : > ${shQuote(INSTALL_LOG)}
      stage() { echo "$1"; echo "$1" >> ${shQuote(INSTALL_LOG)}; }
      stage '[1/7] 获取最新版本'
      rm -f ${ROOT}/tmp/sing-box.tar.gz
      ${CURL} -fsSL https://api.github.com/repos/SagerNet/sing-box/releases/latest -o ${ROOT}/tmp/latest.json
      VERSION=$(sed -n 's/.*"tag_name"[ ]*:[ ]*"v\\([^"]*\\)".*/\\1/p' ${ROOT}/tmp/latest.json | head -n 1)
      test -n "$VERSION"
      MACHINE=$(uname -m 2>/dev/null || echo unknown)
      ABI=$(getprop ro.product.cpu.abi 2>/dev/null || true)
      ABI2=$(getprop ro.product.cpu.abilist 2>/dev/null || true)
      case "$ABI" in
        arm64-v8a|aarch64|arm64) ARCH=arm64 ;;
        armeabi-v7a|armeabi|armv7*|armhf) ARCH=arm ;;
        x86_64|amd64) ARCH=amd64 ;;
        x86|i386|i486|i586|i686) ARCH=386 ;;
        riscv64) echo '官方 Release 暂无 Android riscv64 CLI 包'; exit 3 ;;
        *)
          case "$MACHINE $ABI2" in
            *arm64-v8a*|*aarch64*|*arm64*) ARCH=arm64 ;;
            *armeabi-v7a*|*armeabi*|*armv8l*|*armv7*|*armhf*) ARCH=arm ;;
            *x86_64*|*amd64*) ARCH=amd64 ;;
            *x86*|*i386*|*i486*|*i586*|*i686*) ARCH=386 ;;
            *riscv64*) echo '官方 Release 暂无 Android riscv64 CLI 包'; exit 3 ;;
            *) echo "不支持的架构: uname=$MACHINE, abi=$ABI, abilist=$ABI2"; exit 3 ;;
          esac
          ;;
      esac
      echo "检测到架构: uname=$MACHINE, abi=$ABI, sing-box=$ARCH"
      stage '[2/7] 下载 Android 内核'
      # 设备运行 Android，必须使用 android-* 构建。linux-* ELF 会因缺少
      # glibc/musl 动态加载器而在文件存在时仍报 "No such file or directory"。
      URL="https://github.com/SagerNet/sing-box/releases/download/v$VERSION/sing-box-$VERSION-android-$ARCH.tar.gz"
      ${CURL} -fL "$URL" -o ${ROOT}/tmp/sing-box.tar.gz
      stage '[3/7] 解压内核'
      rm -rf ${ROOT}/tmp/extract && mkdir -p ${ROOT}/tmp/extract
      tar -xzf ${ROOT}/tmp/sing-box.tar.gz -C ${ROOT}/tmp/extract
      NEWBIN=$(find ${ROOT}/tmp/extract -type f -name sing-box | head -n 1)
      test -n "$NEWBIN"
      cp "$NEWBIN" ${ROOT}/bin/sing-box.new && chmod 755 ${ROOT}/bin/sing-box.new
      ${ROOT}/bin/sing-box.new version
      stage '[4/7] 创建并校验配置'
      if ! test -f ${CONFIG}; then
        cat > ${CONFIG} <<'SINGBOX_CONFIG'
${defaultConfig}
SINGBOX_CONFIG
        chmod 600 ${CONFIG}
      fi
      if ! test -f ${SUB_CONFIG}; then echo '{}' > ${SUB_CONFIG}; chmod 600 ${SUB_CONFIG}; fi
      ${ROOT}/bin/sing-box.new check -c ${CONFIG}
      stage '[5/7] 安装服务脚本'
      if test -x ${SERVICE}; then ${SERVICE} stop || true; fi
      rm -f ${BIN}.bak
      if test -x ${BIN}; then mv ${BIN} ${BIN}.bak; fi
      mv ${ROOT}/bin/sing-box.new ${BIN}
      cat > ${SERVICE} <<'SINGBOX_SERVICE'
#!/system/bin/sh
ROOT=/data/sing-box
BIN=$ROOT/bin/sing-box
CONFIG=$ROOT/config/config.json
PIDFILE=$ROOT/run/sing-box.pid
LOG='/sdcard/sing-box内核日志.txt'
LAN_IF=br0
TPROXY_PORT=7893
DNS_PORT=1053
DASHBOARD_PORT=9090
MIXED_PORT=7890
FWMARK=0x2023
ROUTE_TABLE=2023
find_pid() { pgrep -f "$BIN run -c $CONFIG" 2>/dev/null | head -n 1; }
cleanup_tproxy() {
  iptables -w 10 -t mangle -D PREROUTING -i "$LAN_IF" -j SINGBOX 2>/dev/null || true
  iptables -w 10 -t mangle -F SINGBOX 2>/dev/null || true
  iptables -w 10 -t mangle -X SINGBOX 2>/dev/null || true
  iptables -w 10 -t nat -D PREROUTING -i "$LAN_IF" -j SINGBOX_DNS 2>/dev/null || true
  iptables -w 10 -t nat -F SINGBOX_DNS 2>/dev/null || true
  iptables -w 10 -t nat -X SINGBOX_DNS 2>/dev/null || true
  iptables -w 10 -D INPUT -i "$LAN_IF" -p tcp --dport "$DASHBOARD_PORT" -j ACCEPT 2>/dev/null || true
  iptables -w 10 -D INPUT -i "$LAN_IF" -p tcp --dport "$MIXED_PORT" -j ACCEPT 2>/dev/null || true
  while ip rule del fwmark "$FWMARK" table "$ROUTE_TABLE" 2>/dev/null; do :; done
  ip route flush table "$ROUTE_TABLE" 2>/dev/null || true
}
setup_tproxy() {
  cleanup_tproxy
  ip rule add fwmark "$FWMARK" table "$ROUTE_TABLE" || return 1
  ip route add local 0.0.0.0/0 dev lo table "$ROUTE_TABLE" || return 1
  iptables -w 10 -t mangle -N SINGBOX || return 1
  iptables -w 10 -t mangle -A SINGBOX -p tcp --dport 53 -j RETURN || return 1
  iptables -w 10 -t mangle -A SINGBOX -p udp --dport 53 -j RETURN || return 1
  for subnet in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4 255.255.255.255/32; do
    iptables -w 10 -t mangle -A SINGBOX -d "$subnet" -j RETURN || return 1
  done
  iptables -w 10 -t mangle -A SINGBOX -p udp --dport 123 -j RETURN || return 1
  iptables -w 10 -t mangle -A SINGBOX -p tcp -j TPROXY --on-ip 127.0.0.1 --on-port "$TPROXY_PORT" --tproxy-mark "$FWMARK" || return 1
  iptables -w 10 -t mangle -A SINGBOX -p udp -j TPROXY --on-ip 127.0.0.1 --on-port "$TPROXY_PORT" --tproxy-mark "$FWMARK" || return 1
  iptables -w 10 -t mangle -I PREROUTING 1 -i "$LAN_IF" -j SINGBOX || return 1
  iptables -w 10 -t nat -N SINGBOX_DNS || return 1
  iptables -w 10 -t nat -A SINGBOX_DNS -p tcp --dport 53 -j REDIRECT --to-ports "$DNS_PORT" || return 1
  iptables -w 10 -t nat -A SINGBOX_DNS -p udp --dport 53 -j REDIRECT --to-ports "$DNS_PORT" || return 1
  iptables -w 10 -t nat -I PREROUTING 1 -i "$LAN_IF" -j SINGBOX_DNS || return 1
  iptables -w 10 -I INPUT 1 -i "$LAN_IF" -p tcp --dport "$DASHBOARD_PORT" -j ACCEPT || return 1
  iptables -w 10 -I INPUT 1 -i "$LAN_IF" -p tcp --dport "$MIXED_PORT" -j ACCEPT || return 1
}
start_service() {
  mkdir -p "$ROOT/run"
  PID=$(find_pid)
  if test -n "$PID" && kill -0 "$PID" 2>/dev/null; then
    echo "$PID" > "$PIDFILE"
    setup_tproxy || { echo 'TProxy 规则安装失败'; return 1; }
    echo 'sing-box 已在运行，TProxy 规则已刷新'; return 0
  fi
  "$BIN" check -c "$CONFIG" || return 1
  nohup "$BIN" run -c "$CONFIG" >> "$LOG" 2>&1 &
  PID=$!; echo "$PID" > "$PIDFILE"; sleep 2
  if ! kill -0 "$PID" 2>/dev/null; then echo '启动失败，请查看日志'; rm -f "$PIDFILE"; return 1; fi
  if ! setup_tproxy; then
    echo 'TProxy 规则安装失败，已回滚'; cleanup_tproxy; kill "$PID" 2>/dev/null || true; rm -f "$PIDFILE"; return 1
  fi
  echo 'sing-box TProxy 启动成功'
}
stop_service() {
  cleanup_tproxy
  PID=$(cat "$PIDFILE" 2>/dev/null); if test -z "$PID"; then PID=$(find_pid); fi
  if test -z "$PID"; then echo 'sing-box 未运行，TProxy 规则已清理'; rm -f "$PIDFILE"; return 0; fi
  kill "$PID" 2>/dev/null || true
  COUNT=0
  while kill -0 "$PID" 2>/dev/null && test "$COUNT" -lt 10; do sleep 1; COUNT=$((COUNT + 1)); done
  kill -9 "$PID" 2>/dev/null || true; rm -f "$PIDFILE"
  echo 'sing-box 已停止，TProxy 规则已清理'
}
case "$1" in
  start) start_service ;;
  stop) stop_service ;;
  restart) stop_service; start_service ;;
  status) PID=$(cat "$PIDFILE" 2>/dev/null); if test -z "$PID"; then PID=$(find_pid); fi; test -n "$PID" && kill -0 "$PID" 2>/dev/null ;;
  *) echo '用法: sing-box.service {start|stop|restart|status}'; exit 1 ;;
esac
SINGBOX_SERVICE
      chmod 755 ${SERVICE}
      stage '[6/7] 启动服务'
      if ! ${BIN} check -c ${CONFIG} || ! ${SERVICE} start; then
        if test -x ${BIN}.bak; then
          mv ${BIN}.bak ${BIN}
          ${SERVICE} start || true
          echo '新版本启动失败，已回滚旧内核'
        fi
        exit 4
      fi
      rm -f ${BIN}.bak
      rm -rf ${ROOT}/tmp/*
      stage '[7/7] 安装完成'
      ${BIN} version | head -n 1
    `, 240000);
    clearInterval(progressTimer);
    progress.close();
    const installLogResult = await shell(`tail -n 80 ${shQuote(INSTALL_LOG)} 2>/dev/null`, 10000);
    const installLog = installLogResult.content || res.content || '';
    if (!res.success) { createToast(`安装/更新失败：<br>${escapeHtml(installLog || '请查看安装日志')}`, 'red'); return; }
    await isRunning(); await refreshBootButton();
    createToast(`sing-box 已安装/更新：<br>${escapeHtml(installLog)}`, 'green');
    if (!installed) await confirmDialog('singbox_installed', '安装完成',
      `默认 Mixed 代理：<b>${escapeHtml(UFI_DATA.lan_ipaddr)}:7890</b><br>` +
      `面板：<a target="_blank" href="http://${escapeHtml(UFI_DATA.lan_ipaddr)}:${API_PORT}/ui/">http://${escapeHtml(UFI_DATA.lan_ipaddr)}:${API_PORT}/ui/</a><br>` +
      `API 密钥：<code>${secret}</code><br>默认配置为直连，请编辑或上传你自己的 sing-box JSON 配置。`, '知道了');
  };

  const makeButton = (text, handler, className = 'btn') => {
    const button = document.createElement('button'); button.classList.add(className); button.textContent = text; button.onclick = handler; return button;
  };

  (async () => {
    while (!window.UFI_DATA || !UFI_DATA.lan_ipaddr) await wait(100);
    const anchor = document.querySelector('.functions-container');
    if (!anchor || document.querySelector('#KANO_SINGBOX')) return;
    anchor.insertAdjacentHTML('afterend', `
      <div id="KANO_SINGBOX" style="width:100%;margin-top:10px">
        <div class="title" style="margin:6px 0"><strong id="running_singbox">sing-box ${PLUGIN_VERSION}</strong><div style="display:inline-block" id="collapse_singbox_btn"></div></div>
        <div class="collapse" id="collapse_singbox" data-name="close" style="height:0;overflow:hidden">
          <div class="collapse_box">
            <div id="singbox_actions" style="padding:10px;display:flex;gap:10px;flex-wrap:wrap"></div>
            <ul class="deviceList"><li style="padding:10px">
              <iframe id="singbox_iframe" src="javascript:;" style="border:none;padding:0;margin:0;width:100%;height:500px;border-radius:10px;overflow:hidden;opacity:.85"></iframe>
            </li></ul>
          </div>
        </div>
      </div>`);
    const box = document.querySelector('#singbox_actions');
    const configInput = document.createElement('input'); configInput.type = 'file'; configInput.accept = '.json,application/json'; configInput.style.display = 'none';
    configInput.onchange = async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        if (!(await requireRoot()) || !(await isInstalled())) return;
        if (file.size > 2 * 1024 * 1024) return createToast('配置文件不能超过 2MB', 'red');
        await saveUploadedConfig(file);
      } finally { configInput.value = ''; }
    };
    const coreInput = document.createElement('input'); coreInput.type = 'file'; coreInput.style.display = 'none';
    coreInput.onchange = async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        if (!(await requireRoot()) || !(await isInstalled())) return;
        const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        if (magic[0] !== 0x7f || magic[1] !== 0x45 || magic[2] !== 0x4c || magic[3] !== 0x46) return createToast('只能上传 ELF 二进制文件', 'red');
        if (file.size > 100 * 1024 * 1024) return createToast('内核文件不能超过 100MB', 'red');
        const form = new FormData(); form.append('file', file);
        const data = await (await fetch(`${KANO_baseURL}/upload_img`, { method: 'POST', headers: common_headers, body: form })).json();
        if (!data.url || !/^[A-Za-z0-9_./-]+$/.test(data.url)) throw new Error('上传路径无效');
        const source = `${UPLOAD_ROOT}/${data.url.replace(/^\/+/, '')}`;
        const res = await shell(`
          mv ${shQuote(source)} ${BIN}.new && chmod 755 ${BIN}.new || exit 1
          ${BIN}.new version && ${BIN}.new check -c ${CONFIG} || { rm -f ${BIN}.new; exit 2; }
          ${SERVICE} stop || exit 3
          rm -f ${BIN}.bak && mv ${BIN} ${BIN}.bak && mv ${BIN}.new ${BIN}
          if ${SERVICE} start; then
            rm -f ${BIN}.bak
          else
            mv ${BIN}.bak ${BIN}
            ${SERVICE} start || true
            echo '新内核启动失败，已回滚旧内核'
            exit 4
          fi
        `, 120000);
        if (!res.success) throw new Error(res.content || '内核验证或替换失败');
        createToast(`内核更新成功：<br>${escapeHtml(res.content)}`, 'green'); await isRunning();
      } catch (error) { createToast(`内核更新失败：<br>${escapeHtml(error.message || error)}`, 'red'); }
      finally { coreInput.value = ''; }
    };

    const edit = async () => {
      if (!(await requireRoot()) || !(await isInstalled())) return;
      const res = await shell(`cat ${CONFIG}`); if (!res.success) return createToast('读取配置失败', 'red');
      const { el, close } = createFixedToast('singbox_editor', `<div style="pointer-events:all;width:86vw;max-width:850px"><div class="title" style="margin:0">编辑 sing-box JSON</div><div class="inner" style="margin:10px 0"></div><div style="text-align:right"><button class="save">校验并保存</button> <button class="cancel">关闭</button></div></div>`);
      const textarea = document.createElement('textarea'); textarea.value = res.content; textarea.style.cssText = 'width:100%;height:500px;max-height:62vh;box-sizing:border-box;background:#000d;color:#0f0;border:0;padding:8px;font-family:monospace;line-height:1.4';
      el.querySelector('.inner').appendChild(textarea); el.querySelector('.cancel').onclick = close;
      el.querySelector('.save').onclick = async () => { if (!textarea.value.trim()) return createToast('配置不能为空', 'red'); if (await saveUploadedConfig(new File([textarea.value], 'config.json', { type: 'application/json' }))) close(); };
    };
    const backup = async () => {
      if (!(await requireRoot()) || !(await isInstalled())) return;
      const name = `singbox_config_backup_${Date.now()}.json`;
      const res = await shell(`cp ${CONFIG} ${UPLOAD_ROOT}/uploads/${name} && chmod 644 ${UPLOAD_ROOT}/uploads/${name}`);
      if (!res.success) return createToast('备份失败', 'red');
      const a = document.createElement('a'); a.download = name; a.href = `/api/uploads/${name}`; a.target = '_blank'; a.click();
    };
    const start = async () => { if (!(await requireRoot()) || !(await isInstalled())) return; const res = await shell(`${BIN} check -c ${CONFIG} && ${SERVICE} start`); createToast(res.success ? 'sing-box 已启动' : escapeHtml(res.content), res.success ? 'green' : 'red'); await isRunning(); };
    const stop = async () => { if (!(await requireRoot()) || !(await isInstalled())) return; const res = await shell(`${SERVICE} stop`); createToast(res.success ? 'sing-box 已停止' : escapeHtml(res.content), res.success ? 'green' : 'red'); await isRunning(); };
    let uninstallClicks = 0; let uninstallTimer = null;
    const uninstall = async () => {
      uninstallClicks++; clearTimeout(uninstallTimer); uninstallTimer = setTimeout(() => { uninstallClicks = 0; }, 3000);
      if (uninstallClicks < 3) return createToast(`再点击 ${3 - uninstallClicks} 次确认卸载`, 'red');
      uninstallClicks = 0; if (!(await requireRoot())) return;
      const res = await shell(`${SERVICE} stop 2>/dev/null || true; rm -rf ${ROOT}; sed -i '\\|${SERVICE} start|d' ${BOOT}`);
      createToast(res.success ? 'sing-box 已卸载' : `卸载失败：${escapeHtml(res.content)}`, res.success ? 'green' : 'red'); await isRunning(); await refreshBootButton();
    };
    const toggleBoot = async () => {
      if (!(await requireRoot()) || !(await isInstalled())) return;
      if (await isBootEnabled()) { await shell(`sed -i '\\|${SERVICE} start|d' ${BOOT}`); createToast('已取消开机自启', 'green'); }
      else { await shell(`touch ${BOOT}; grep -qxF '${SERVICE} start' ${BOOT} || echo '${SERVICE} start' >> ${BOOT}`); createToast('已设置开机自启', 'green'); }
      await refreshBootButton();
    };
    const openUrl = (url) => { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.click(); };
    const panelUrl = () => `http://${UFI_DATA.lan_ipaddr}:${API_PORT}/ui/?t=${Date.now()}`;
    const ensurePanelRunning = async () => {
      if (!(await requireRoot()) || !(await isInstalled())) return false;
      if (!(await isRunning())) {
        createToast('sing-box 未运行，正在启动…');
        const res = await shell(`${BIN} check -c ${CONFIG} && ${SERVICE} start`, 120000);
        if (!res.success) { createToast(`面板启动失败：<br>${escapeHtml(res.content || '请查看日志')}`, 'red'); return false; }
        await wait(800);
      }
      return isRunning();
    };
    const refreshPanel = async () => {
      if (!(await ensurePanelRunning())) return;
      document.querySelector('#singbox_iframe').src = panelUrl();
    };
    const openPanel = async () => {
      if (!(await ensurePanelRunning())) return;
      const url = panelUrl();
      document.querySelector('#singbox_iframe').src = url;
      openUrl(url);
    };

    box.append(configInput, coreInput,
      makeButton('编辑配置', edit), makeButton('上传配置', () => configInput.click()), makeButton('备份配置', backup),
      makeButton('订阅设置', editSubscriptions), makeButton('更新订阅', updateSubscriptions),
      makeButton('安装/在线更新', installOrUpdate), makeButton('启动', start), makeButton('停止', stop), makeButton('重启', restart),
      makeButton('卸载', uninstall), makeButton('开机自启', toggleBoot), makeButton('上传内核', () => coreInput.click()),
      makeButton('刷新面板', refreshPanel), makeButton('打开面板', openPanel),
      makeButton('查看日志', async () => { const res = await shell(`tail -n 200 ${shQuote(LOG)} 2>/dev/null`); showLog(res.content); }),
      makeButton('官方文档', () => openUrl('https://sing-box.sagernet.org/configuration/')),
      makeButton('刷新状态', async () => { await isRunning(); await refreshBootButton(); createToast('状态已刷新', 'green'); }));
    const buttons = [...box.querySelectorAll('button')];
    const bootButton = buttons.find((button) => button.textContent === '开机自启'); if (bootButton) bootButton.id = 'singbox_boot';
    collapseGen('#collapse_singbox_btn', '#collapse_singbox', '#collapse_singbox', async () => {
      await isRunning(); await refreshBootButton();
      if (await isRunning()) document.querySelector('#singbox_iframe').src = panelUrl();
    });
    await isRunning(); await refreshBootButton();
  })();
})();
//</script>
