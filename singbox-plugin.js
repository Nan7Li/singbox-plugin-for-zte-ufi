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
  const MIXED_PORT = 7890;
  const PLUGIN_VERSION = '2.5.0-subscriptions';
  // 订阅提供方：key 对应 subscriptions.json 字段，prefix 为导入出站的标签前缀。
  const PROVIDERS = [
    { key: 'glados', name: 'GLaDOS', prefix: 'GLaDOS/' },
    { key: 'xueshan', name: '雪山', prefix: 'XueShan/' },
  ];
  // 插件维护的总选择器，每次更新订阅时重建。
  const MANAGED_SELECTOR = '订阅/总选择';
  const GROUP_TYPES = new Set(['selector', 'urltest']);

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomString = (length = 16) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let value = '';
    for (const byte of bytes) value += chars[byte % chars.length];
    return value;
  };
  const escapeHtml = (value = '') => String(value ?? '')
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
    const normalized = value.replace(/\s+/g, '').replaceAll('-', '+').replaceAll('_', '/').replace(/=+$/, '');
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  };
  const safeDecode = (value = '') => { try { return decodeURIComponent(value); } catch { return value; } };
  const isTruthy = (value) => ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
  const downloadText = (name, text) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = name; a.href = url; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const requireInstalled = async () => {
    if (!(await requireRoot())) return false;
    if (await isInstalled()) return true;
    createToast('sing-box 尚未安装，请先点击“安装/在线更新”。', 'red');
    return false;
  };
  const isRunning = async () => {
    // 交给服务脚本判断：它会校验 /proc/PID/exe，避免 PID 复用造成误判。
    const res = await shell(`test -x ${SERVICE} && ${SERVICE} status && echo running`);
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
          <button class="ok">${escapeHtml(ok)}</button>${cancel ? `<button class="cancel">${escapeHtml(cancel)}</button>` : ''}
        </div>
      </div>`);
    const done = (answer) => { close(); resolve(answer); };
    el.querySelector('.ok').onclick = () => done(true);
    const cancelButton = el.querySelector('.cancel');
    if (cancelButton) cancelButton.onclick = () => done(false);
  });

  const readConfig = async () => {
    const res = await shell(`cat ${CONFIG}`);
    if (!res.success) throw new Error('无法读取当前配置');
    try { return JSON.parse(res.content); } catch {
      throw new Error('当前配置不是标准 JSON（可能包含注释或尾随逗号），请先在“编辑配置”中修正');
    }
  };
  const panelInfo = async () => {
    const config = await readConfig().catch(() => ({}));
    const api = config?.experimental?.clash_api || {};
    const port = Number(String(api.external_controller || '').split(':').pop()) || API_PORT;
    return { port, secret: api.secret || '' };
  };

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
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const refresh = async (notify = false) => {
      // 弹窗被其他方式关闭时停止轮询，避免后台一直执行 root 命令。
      if (!el.isConnected) return stop();
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
    el.querySelector('.download').onclick = () => downloadText(`sing-box-log-${Date.now()}.txt`, logEl.textContent);
    el.querySelector('.close').onclick = () => { stop(); close(); };
    refresh();
    timer = setInterval(refresh, 1500);
  };

  const restart = async () => {
    if (!(await requireInstalled())) return false;
    createToast('正在校验配置并重启 sing-box…');
    const res = await shell(`${BIN} check -c ${CONFIG} && ${SERVICE} restart`, 120000);
    await isRunning();
    if (!res.success) { createToast(`重启失败：<br>${escapeHtml(res.content || '请查看日志')}`, 'red'); return false; }
    createToast('sing-box 已重启', 'green');
    return true;
  };

  const uploadFile = async (file) => {
    const formData = new FormData(); formData.append('file', file);
    const response = await fetch(`${KANO_baseURL}/upload_img`, { method: 'POST', headers: common_headers, body: formData });
    const data = await response.json();
    if (!data.url || !/^[A-Za-z0-9_./-]+$/.test(data.url) || data.url.includes('..')) throw new Error(data.error || '上传接口未返回有效路径');
    return `${UPLOAD_ROOT}/${data.url.replace(/^\/+/, '')}`;
  };

  // 校验并替换配置。服务运行中则重启，重启失败自动恢复旧配置；失败时抛出异常。
  const applyConfig = async (file) => {
    const source = await uploadFile(file);
    const candidate = `${ROOT}/config/config.candidate.json`;
    const res = await shell(`
      mv ${shQuote(source)} ${candidate} || exit 1
      chmod 600 ${candidate}
      ${BIN} check -c ${candidate} || { rm -f ${candidate}; exit 2; }
      cp ${CONFIG} ${CONFIG}.bak 2>/dev/null || true
      mv ${candidate} ${CONFIG}
      if ${SERVICE} status; then
        if ! ${SERVICE} restart; then
          if test -f ${CONFIG}.bak; then
            cp ${CONFIG}.bak ${CONFIG}
            ${SERVICE} start || true
            echo '新配置启动失败，已恢复旧配置'
          fi
          exit 3
        fi
        echo SINGBOX_RESTARTED
      fi
    `, 120000);
    if (!res.success) throw new Error(res.content || '配置校验或重启失败');
    await wait(500); await isRunning();
    return (res.content || '').includes('SINGBOX_RESTARTED');
  };

  const saveUploadedConfig = async (file) => {
    try {
      const restarted = await applyConfig(file);
      createToast(restarted ? '配置已通过校验并生效' : '配置已通过校验并保存（sing-box 未运行，启动后生效）', 'green');
      return true;
    } catch (error) {
      createToast(`保存失败，旧配置未被覆盖：<br>${escapeHtml(error.message || error)}`, 'red'); return false;
    }
  };

  const uniqueTag = (base, used) => {
    const root = base || '未命名节点';
    let tag = root; let index = 2;
    while (used.has(tag)) tag = `${root}-${index++}`;
    used.add(tag); return tag;
  };

  class UnsupportedNode extends Error {}

  const buildTls = (query, enabled) => {
    if (!enabled) return undefined;
    const tls = { enabled: true };
    const serverName = query.get('sni') || query.get('peer') || query.get('servername');
    if (serverName) tls.server_name = serverName;
    if (isTruthy(query.get('insecure') || query.get('allowInsecure') || query.get('allow_insecure'))) tls.insecure = true;
    const alpn = query.get('alpn');
    if (alpn) tls.alpn = alpn.split(',').map((item) => item.trim()).filter(Boolean);
    const fingerprint = query.get('fp');
    if (fingerprint && fingerprint !== 'none') tls.utls = { enabled: true, fingerprint };
    return tls;
  };

  const buildTransport = ({ type, path, host, serviceName }) => {
    switch ((type || 'tcp').toLowerCase()) {
      case 'tcp': case 'raw': case 'none': return undefined;
      case 'ws': {
        const transport = { type: 'ws', path: path || '/' };
        const earlyData = transport.path.match(/[?&]ed=(\d+)/);
        if (earlyData) {
          transport.max_early_data = Number(earlyData[1]);
          transport.early_data_header_name = 'Sec-WebSocket-Protocol';
          transport.path = transport.path.replace(/([?&])ed=\d+&?/, '$1').replace(/[?&]$/, '') || '/';
        }
        if (host) transport.headers = { Host: host };
        return transport;
      }
      case 'grpc': return { type: 'grpc', service_name: serviceName || path || '' };
      case 'httpupgrade': {
        const transport = { type: 'httpupgrade', path: path || '/' };
        if (host) transport.host = host;
        return transport;
      }
      case 'h2': case 'http': {
        const transport = { type: 'http' };
        if (path) transport.path = path;
        if (host) transport.host = host.split(',').map((item) => item.trim()).filter(Boolean);
        return transport;
      }
      default: throw new UnsupportedNode(`sing-box 不支持的传输方式 ${type}`);
    }
  };

  const queryTransport = (query) => buildTransport({
    type: query.get('type'), path: query.get('path'), host: query.get('host'), serviceName: query.get('serviceName'),
  });

  const endpointOf = (url, name) => {
    const server = url.hostname.replace(/^\[|\]$/g, '');
    const serverPort = Number(url.port);
    if (!server || !serverPort) throw new Error(`节点缺少服务器或端口：${name}`);
    return { server, server_port: serverPort };
  };

  const parseVmess = (line) => {
    const data = JSON.parse(base64ToUtf8(line.slice('vmess://'.length)));
    const name = String(data.ps || '').trim();
    const server = String(data.add || '').trim();
    const serverPort = Number(data.port);
    if (!server || !serverPort || !data.id) throw new Error(`VMess 节点信息不完整：${name}`);
    const tlsEnabled = ['tls', 'reality'].includes(String(data.tls || '').toLowerCase());
    const query = new URLSearchParams();
    if (data.sni || data.host) query.set('sni', data.sni || data.host);
    if (data.alpn) query.set('alpn', data.alpn);
    if (data.fp) query.set('fp', data.fp);
    if (data.allowInsecure || data.insecure) query.set('insecure', '1');
    const net = String(data.net || 'tcp').toLowerCase();
    if (['kcp', 'mkcp', 'quic', 'xhttp', 'splithttp'].includes(net)) throw new UnsupportedNode(`sing-box 不支持的传输方式 ${net}`);
    const node = {
      type: 'vmess', server, server_port: serverPort, uuid: data.id,
      security: data.scy || 'auto', alter_id: Number(data.aid) || 0, packet_encoding: 'xudp',
    };
    const tls = buildTls(query, tlsEnabled); if (tls) node.tls = tls;
    const transport = buildTransport({ type: net, path: data.path, host: data.host, serviceName: data.path });
    if (transport) node.transport = transport;
    return { name, node };
  };

  const parseShadowsocks = (line) => {
    const hashIndex = line.indexOf('#');
    const name = hashIndex >= 0 ? safeDecode(line.slice(hashIndex + 1)) : '';
    let body = (hashIndex >= 0 ? line.slice(0, hashIndex) : line).slice('ss://'.length);
    // 旧格式：ss://base64(method:password@host:port)
    if (!body.includes('@')) {
      const [encoded, ...rest] = body.split('?');
      body = base64ToUtf8(encoded) + (rest.length ? `?${rest.join('?')}` : '');
    }
    const url = new URL(`ss://${body}`);
    let method; let password;
    if (url.password) { method = safeDecode(url.username); password = safeDecode(url.password); }
    else {
      const userInfo = base64ToUtf8(safeDecode(url.username));
      const index = userInfo.indexOf(':');
      method = userInfo.slice(0, index); password = userInfo.slice(index + 1);
    }
    if (!method || !password) throw new Error(`Shadowsocks 节点缺少加密方式或密码：${name}`);
    const node = { type: 'shadowsocks', ...endpointOf(url, name), method, password };
    const plugin = url.searchParams.get('plugin');
    if (plugin) {
      const [pluginName, ...opts] = plugin.split(';');
      const normalized = pluginName === 'simple-obfs' ? 'obfs-local' : pluginName;
      if (!['obfs-local', 'v2ray-plugin'].includes(normalized)) throw new UnsupportedNode(`sing-box 不支持的 SS 插件 ${pluginName}`);
      node.plugin = normalized;
      if (opts.length) node.plugin_opts = opts.join(';');
    }
    return { name, node };
  };

  // 解析常见分享链接，返回不带 tag 的 sing-box 出站。
  const parseShareLink = (line) => {
    const scheme = (line.match(/^([a-z0-9+.-]+):\/\//i) || [])[1]?.toLowerCase();
    if (!scheme) throw new Error('无法识别的节点链接');
    if (scheme === 'vmess') return parseVmess(line);
    if (scheme === 'ss') return parseShadowsocks(line);
    if (!['vless', 'trojan', 'hysteria2', 'hy2', 'tuic', 'anytls'].includes(scheme)) throw new UnsupportedNode(`暂不支持的协议 ${scheme}`);
    let normalized = line;
    let serverPorts;
    if (scheme === 'hysteria2' || scheme === 'hy2') {
      // 端口跳跃写法 host:443,20000-30000 无法被 URL 解析，先拆出来。
      const match = line.match(/^([^@]+@(?:\[[^\]]+\]|[^:/?#]+)):(\d+)([,\-][0-9,\-]+)(?=[/?#]|$)/);
      if (match) {
        const ports = `${match[2]}${match[3]}`.split(',').filter(Boolean);
        serverPorts = ports.filter((item) => item.includes('-')).map((item) => item.replace('-', ':'));
        normalized = `${match[1]}:${match[2]}${line.slice(match[0].length)}`;
      }
    }
    const url = new URL(normalized);
    const query = url.searchParams;
    const name = safeDecode(url.hash.slice(1));
    const endpoint = endpointOf(url, name);
    const userInfo = safeDecode(url.username) + (url.password ? `:${safeDecode(url.password)}` : '');
    switch (scheme) {
      case 'vless': case 'trojan': {
        const security = (query.get('security') || (scheme === 'trojan' ? 'tls' : '')).toLowerCase();
        const tls = buildTls(query, security === 'tls' || security === 'reality' || security === 'xtls');
        if (security === 'reality') {
          const publicKey = query.get('pbk');
          if (!publicKey) throw new Error(`Reality 节点缺少公钥：${name}`);
          tls.reality = { enabled: true, public_key: publicKey };
          if (query.get('sid')) tls.reality.short_id = query.get('sid');
          // sing-box 的 Reality 客户端必须启用 uTLS。
          if (!tls.utls) tls.utls = { enabled: true, fingerprint: 'chrome' };
        }
        const node = scheme === 'vless'
          ? { type: 'vless', ...endpoint, uuid: safeDecode(url.username), packet_encoding: 'xudp' }
          : { type: 'trojan', ...endpoint, password: userInfo };
        const flow = query.get('flow');
        if (scheme === 'vless' && flow) node.flow = flow.replace(/-udp443$/, '');
        if (tls) node.tls = tls;
        const transport = queryTransport(query);
        if (transport) node.transport = transport;
        return { name, node };
      }
      case 'hysteria2': case 'hy2': {
        const node = { type: 'hysteria2', ...endpoint, password: userInfo, tls: buildTls(query, true) };
        const mport = query.get('mport');
        if (mport) serverPorts = [...(serverPorts || []), ...mport.split(',').filter((item) => item.includes('-')).map((item) => item.replace('-', ':'))];
        if (serverPorts?.length) node.server_ports = serverPorts;
        const obfs = query.get('obfs');
        if (obfs && obfs !== 'none') node.obfs = { type: obfs, password: query.get('obfs-password') || '' };
        return { name, node };
      }
      case 'tuic': {
        const node = {
          type: 'tuic', ...endpoint, uuid: safeDecode(url.username), password: safeDecode(url.password),
          tls: buildTls(query, true),
        };
        if (query.get('congestion_control')) node.congestion_control = query.get('congestion_control');
        if (query.get('udp_relay_mode')) node.udp_relay_mode = query.get('udp_relay_mode');
        return { name, node };
      }
      default:
        return { name, node: { type: 'anytls', ...endpoint, password: userInfo, tls: buildTls(query, true) } };
    }
  };

  // 生成某个提供方的“节点选择 / 自动选择”分组。
  const providerGroups = (provider, nodeTags, extraGroups = []) => {
    if (!nodeTags.length) throw new Error(`${provider.name} 订阅没有可用节点`);
    return [
      { type: 'selector', tag: provider.selectTag, outbounds: [provider.autoTag, ...extraGroups, ...nodeTags], default: provider.autoTag },
      { type: 'urltest', tag: provider.autoTag, outbounds: nodeTags },
    ];
  };

  const importShareLinks = (text, provider, used) => {
    const nodes = []; const skipped = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim(); if (!line || !line.includes('://')) continue;
      try {
        const { name, node } = parseShareLink(line);
        node.tag = uniqueTag(`${provider.prefix}${name || `${node.type}-${nodes.length + 1}`}`, used);
        nodes.push(node);
      } catch (error) {
        skipped.push(error.message || String(error));
      }
    }
    if (!nodes.length) throw new Error(`${provider.name} 订阅没有可用节点${skipped.length ? `：${skipped[0]}` : ''}`);
    const nodeTags = nodes.map((node) => node.tag);
    return { outbounds: [...providerGroups(provider, nodeTags), ...nodes], nodeCount: nodes.length, skipped };
  };

  // 导入 sing-box JSON 订阅，修正标签前缀和失效引用。
  const importSingBoxJson = (source, provider, used, resolver) => {
    const all = Array.isArray(source?.outbounds) ? source.outbounds : [];
    // block / dns 特殊出站在 sing-box 1.13 已移除，直接丢弃。
    const kept = all.filter((item) => item && item.tag && item.type && !['block', 'dns'].includes(item.type));
    const tagMap = new Map();
    for (const item of kept) if (!tagMap.has(item.tag)) tagMap.set(item.tag, uniqueTag(`${provider.prefix}${item.tag}`, used));
    let outbounds = kept.filter((item, index) => kept.findIndex((other) => other.tag === item.tag) === index).map((item) => {
      const next = structuredClone(item);
      next.tag = tagMap.get(item.tag);
      if (Array.isArray(next.outbounds)) next.outbounds = next.outbounds.filter((tag) => tagMap.has(tag)).map((tag) => tagMap.get(tag));
      if (next.default) { if (tagMap.has(next.default)) next.default = tagMap.get(next.default); else delete next.default; }
      if (next.detour) { if (tagMap.has(next.detour)) next.detour = tagMap.get(next.detour); else delete next.detour; }
      // 旧版拨号字段 domain_strategy 在新内核中已移除，迁移为 domain_resolver。
      if ('domain_strategy' in next) {
        const strategy = next.domain_strategy; delete next.domain_strategy;
        if (strategy && resolver && !next.domain_resolver) next.domain_resolver = { server: resolver, strategy };
      }
      return next;
    });
    // 删除被清空的分组及对它们的引用，直到稳定。
    for (;;) {
      const empty = new Set(outbounds.filter((item) => GROUP_TYPES.has(item.type) && !item.outbounds?.length).map((item) => item.tag));
      if (!empty.size) break;
      outbounds = outbounds.filter((item) => !empty.has(item.tag)).map((item) => {
        if (!Array.isArray(item.outbounds)) return item;
        const next = { ...item, outbounds: item.outbounds.filter((tag) => !empty.has(tag)) };
        if (next.default && empty.has(next.default)) delete next.default;
        return next;
      });
    }
    const groups = outbounds.filter((item) => GROUP_TYPES.has(item.type)).map((item) => item.tag);
    const nodeTags = outbounds.filter((item) => !GROUP_TYPES.has(item.type) && item.type !== 'direct').map((item) => item.tag);
    return { outbounds: [...providerGroups(provider, nodeTags, groups), ...outbounds], nodeCount: nodeTags.length, skipped: [] };
  };

  const importSubscription = (raw, provider, resolver) => {
    const used = new Set();
    provider = { ...provider, selectTag: uniqueTag(`${provider.prefix}节点选择`, used), autoTag: uniqueTag(`${provider.prefix}自动选择`, used) };
    const text = raw.replace(/^﻿/, '').trim();
    if (!text) throw new Error(`${provider.name} 订阅内容为空`);
    if (text.startsWith('{') || text.startsWith('[')) {
      let json;
      try { json = JSON.parse(text); } catch { throw new Error(`${provider.name} 订阅 JSON 解析失败`); }
      return { provider, ...importSingBoxJson(Array.isArray(json) ? json[0] : json, provider, used, resolver) };
    }
    if (/^(proxies|proxy-groups|mixed-port|port):/m.test(text)) throw new Error(`${provider.name} 返回的是 Clash YAML，请改用 sing-box 或通用 Base64 订阅链接`);
    if (text.includes('://')) return { provider, ...importShareLinks(text, provider, used) };
    let decoded;
    try { decoded = base64ToUtf8(text); } catch { throw new Error(`${provider.name} 订阅格式无法识别`); }
    return { provider, ...importShareLinks(decoded, provider, used) };
  };

  // 合并订阅出站到当前配置，并修复用户自有分组中的失效引用。
  const mergeSubscriptions = (config, results) => {
    if (!Array.isArray(config.outbounds)) throw new Error('当前配置缺少 outbounds');
    config.route ||= {};
    const prefixes = PROVIDERS.map((provider) => provider.prefix);
    const isManaged = (tag) => tag === MANAGED_SELECTOR || prefixes.some((prefix) => String(tag || '').startsWith(prefix));
    const updatedPrefixes = results.map((result) => result.provider.prefix);
    // 只替换本次更新的提供方，未配置/未更新的提供方保留原节点。
    const preserved = config.outbounds.filter((item) => item.tag !== MANAGED_SELECTOR && !updatedPrefixes.some((prefix) => String(item.tag || '').startsWith(prefix)));
    const imported = results.flatMap((result) => result.outbounds);
    const providerSelectors = PROVIDERS.map((provider) => {
      const fresh = results.find((result) => result.provider.key === provider.key);
      if (fresh) return fresh.provider.selectTag;
      const old = preserved.find((item) => item.tag === `${provider.prefix}节点选择`);
      return old?.tag;
    }).filter(Boolean);
    const directTag = preserved.find((item) => item.type === 'direct')?.tag;
    const managed = { type: 'selector', tag: MANAGED_SELECTOR, outbounds: [...providerSelectors, ...(directTag ? [directTag] : [])], default: providerSelectors[0] };
    const outbounds = [...preserved, managed, ...imported];
    const tags = new Set(outbounds.map((item) => item.tag));
    let repaired = 0;
    config.outbounds = outbounds.map((item) => {
      if (isManaged(item.tag)) return item;
      const next = { ...item };
      if (Array.isArray(next.outbounds)) {
        const filtered = next.outbounds.filter((tag) => tags.has(tag));
        if (filtered.length !== next.outbounds.length) repaired++;
        next.outbounds = filtered.length ? filtered : [MANAGED_SELECTOR];
      }
      if (next.default && !tags.has(next.default)) { delete next.default; repaired++; }
      if (next.detour && !tags.has(next.detour)) { delete next.detour; repaired++; }
      return next;
    });
    const rules = Array.isArray(config.route.rules) ? config.route.rules : [];
    const hasOutboundRules = rules.some((rule) => rule && rule.outbound);
    const missingRule = rules.find((rule) => rule?.outbound && !tags.has(rule.outbound));
    if (missingRule) throw new Error(`路由规则引用了不存在的出站 ${missingRule.outbound}，请先在“编辑配置”中修改`);
    let finalChanged = false;
    const finalTag = config.route.final;
    if (finalTag && !tags.has(finalTag)) { config.route.final = MANAGED_SELECTOR; finalChanged = true; }
    else if ((!finalTag || finalTag === directTag) && !hasOutboundRules) {
      // 只有默认直连且没有任何分流规则时，才自动把默认出站切到订阅，避免覆盖用户自定义分流。
      config.route.final = MANAGED_SELECTOR; finalChanged = true;
    }
    return { config, repaired, finalChanged };
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

  const validateSubscriptionUrl = (name, value) => {
    let url;
    try { url = new URL(value); } catch { throw new Error(`${name} 订阅地址无效`); }
    if (url.protocol !== 'https:') throw new Error(`${name} 订阅必须是 HTTPS 地址`);
    url.hash = '';
    return url;
  };

  const editSubscriptions = async () => {
    if (!(await requireInstalled())) return;
    let current;
    try { current = await readSubscriptions(); } catch (error) { return createToast(escapeHtml(error.message), 'red'); }
    const { el, close } = createFixedToast('singbox_subscriptions', `
      <div style="pointer-events:all;width:88vw;max-width:720px">
        <div class="title" style="margin:0">订阅设置</div>
        ${PROVIDERS.map((provider) => `
          <label style="display:block;margin-top:12px">${escapeHtml(provider.name)} 订阅（sing-box JSON 或通用 Base64 订阅，可留空）</label>
          <input class="sub_${provider.key}" type="url" style="width:100%;box-sizing:border-box" placeholder="https://...">`).join('')}
        <div style="margin-top:12px;font-size:.62rem;opacity:.8">至少填写一个。订阅地址仅保存在设备 ${SUB_CONFIG}</div>
        <div style="margin-top:14px;text-align:right"><button class="save">保存</button> <button class="cancel">取消</button></div>
      </div>`);
    for (const provider of PROVIDERS) el.querySelector(`.sub_${provider.key}`).value = current[provider.key] || '';
    el.querySelector('.cancel').onclick = close;
    el.querySelector('.save').onclick = async () => {
      const subscriptions = Object.fromEntries(PROVIDERS.map((provider) => [provider.key, el.querySelector(`.sub_${provider.key}`).value.trim()]));
      try {
        if (!Object.values(subscriptions).some(Boolean)) throw new Error('请至少填写一个订阅地址');
        for (const provider of PROVIDERS) if (subscriptions[provider.key]) validateSubscriptionUrl(provider.name, subscriptions[provider.key]);
        await saveSubscriptions(subscriptions); close(); createToast('订阅设置已保存', 'green');
      } catch (error) { createToast(escapeHtml(error.message || error), 'red'); }
    };
  };

  const downloadSubscription = async (provider, url) => {
    const file = `${SUB_DIR}/${provider.key}.raw`;
    const res = await shell(`
      mkdir -p ${SUB_DIR}
      rm -f ${file}
      ${CURL} -fsSL --connect-timeout 15 --max-time 90 ${shQuote(url.href)} -o ${file} || ${CURL} -fsSL --connect-timeout 15 --max-time 90 -x http://127.0.0.1:${MIXED_PORT} ${shQuote(url.href)} -o ${file} || exit 11
      test -s ${file} || exit 12
      printf 'SUB='; base64 ${file} | tr -d '\\n'; printf '\\n'
    `, 220000);
    const encoded = (res.content || '').match(/(?:^|\n)SUB=([^\n]+)/)?.[1];
    if (!res.success || !encoded) throw new Error(`下载 ${provider.name} 订阅失败，请检查网络和订阅地址`);
    return base64ToUtf8(encoded);
  };

  const updateSubscriptions = async () => {
    if (!(await requireInstalled())) return;
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
      const targets = PROVIDERS.filter((provider) => subscriptions[provider.key])
        .map((provider) => ({ provider, url: validateSubscriptionUrl(provider.name, subscriptions[provider.key]) }));
      if (!targets.length) throw new Error('请先打开“订阅设置”填写订阅地址');
      const config = await readConfig();
      const resolverOption = config.route?.default_domain_resolver;
      const resolver = typeof resolverOption === 'string' ? resolverOption : resolverOption?.server;
      const results = [];
      for (const [index, { provider, url }] of targets.entries()) {
        setProgress(15 + Math.round((index / targets.length) * 45), `正在下载并转换 ${provider.name} 订阅…`);
        results.push(importSubscription(await downloadSubscription(provider, url), provider, resolver));
      }
      setProgress(70, '正在合并配置并校验…');
      const { repaired, finalChanged } = mergeSubscriptions(config, results);
      const restarted = await applyConfig(new File([JSON.stringify(config, null, 2)], 'config.json', { type: 'application/json' }));
      setProgress(100, '订阅更新成功'); await wait(700); progress.close();
      const summary = results.map((result) => `${escapeHtml(result.provider.name)} ${result.nodeCount} 个节点${result.skipped.length ? `（跳过 ${result.skipped.length} 个不支持的节点）` : ''}`).join('，');
      createToast(`订阅更新完成：${summary}` +
        (finalChanged ? `<br>默认出站已设置为“${escapeHtml(MANAGED_SELECTOR)}”` : '') +
        (repaired ? `<br>已修复 ${repaired} 处失效的节点引用` : '') +
        (restarted ? '' : '<br>sing-box 未运行，启动后生效'), 'green');
    } catch (error) {
      progress.close(); createToast(`订阅更新失败，旧配置已保留：<br>${escapeHtml(error.message || error)}`, 'red');
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
        { type: 'mixed', tag: 'mixed-in', listen: '0.0.0.0', listen_port: MIXED_PORT },
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
      # 先直连 GitHub，失败时尝试通过本机 Mixed 代理（sing-box 已在运行时可用）。
      gh_fetch() { ${CURL} --connect-timeout 15 "$@" || ${CURL} --connect-timeout 15 -x http://127.0.0.1:${MIXED_PORT} "$@"; }
      stage '[1/7] 获取最新版本'
      rm -f ${ROOT}/tmp/sing-box.tar.gz
      VERSION=$(gh_fetch -fsSL --max-time 30 https://api.github.com/repos/SagerNet/sing-box/releases/latest 2>/dev/null | sed -n 's/.*"tag_name"[ ]*:[ ]*"v\\([^"]*\\)".*/\\1/p' | head -n 1)
      if test -z "$VERSION"; then
        # API 被限流时，从 releases/latest 的跳转地址解析版本号。
        VERSION=$(gh_fetch -fsSI --max-time 30 https://github.com/SagerNet/sing-box/releases/latest 2>/dev/null | tr -d '\\r' | sed -n 's#^[Ll]ocation:.*/tag/v\\([^ ]*\\).*#\\1#p' | head -n 1)
      fi
      test -n "$VERSION" || { echo '无法获取 sing-box 最新版本，请检查设备能否访问 GitHub'; exit 2; }
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
      stage "检测到架构: uname=$MACHINE, abi=$ABI, sing-box=$ARCH, 版本=v$VERSION"
      stage '[2/7] 下载 Android 内核'
      # 设备运行 Android，必须使用 android-* 构建。linux-* ELF 会因缺少
      # glibc/musl 动态加载器而在文件存在时仍报 "No such file or directory"。
      URL="https://github.com/SagerNet/sing-box/releases/download/v$VERSION/sing-box-$VERSION-android-$ARCH.tar.gz"
      gh_fetch -fL --retry 2 --max-time 600 "$URL" -o ${ROOT}/tmp/sing-box.tar.gz
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
      ${ROOT}/bin/sing-box.new check -c ${CONFIG} || { echo '现有配置无法通过新内核校验，已停止更新（旧内核未改动）'; rm -f ${ROOT}/bin/sing-box.new; exit 5; }
      stage '[5/7] 安装服务脚本'
      if test -x ${SERVICE}; then ${SERVICE} stop || true; fi
      rm -f ${BIN}.bak
      if test -x ${BIN}; then mv ${BIN} ${BIN}.bak; fi
      mv ${ROOT}/bin/sing-box.new ${BIN}
      cat > ${SERVICE} <<'SINGBOX_SERVICE'
#!/system/bin/sh
# Unofficial service helper for compatible ZTE UFI Tools environments.
# Review interface names and firewall rules before use.
# 本文件会被 singbox-plugin.js 原样内嵌写入设备；修改时两边需保持一致，
# 且不要使用反引号、反斜杠或美元符加左花括号（会破坏 JS 模板字符串）。
ROOT=/data/sing-box
BIN=$ROOT/bin/sing-box
CONFIG=$ROOT/config/config.json
PIDFILE=$ROOT/run/sing-box.pid
LOG='/sdcard/sing-box内核日志.txt'
LOG_MAX_BYTES=5242880
LAN_IF=br0
LAN_WAIT_SECONDS=30
TPROXY_PORT=7893
DNS_PORT=1053
DASHBOARD_PORT=9090
MIXED_PORT=7890
FWMARK=0x2023
ROUTE_TABLE=2023

# 只认可执行文件确实是 $BIN 的进程，避免 PID 被系统复用后误杀其他进程。
is_singbox_pid() {
  test -n "$1" && kill -0 "$1" 2>/dev/null || return 1
  case "$(readlink "/proc/$1/exe" 2>/dev/null)" in
    "$BIN"|"$BIN "*) return 0 ;;
  esac
  return 1
}

find_pid() {
  for P in $(pgrep -f "$BIN run" 2>/dev/null); do
    if is_singbox_pid "$P"; then echo "$P"; return 0; fi
  done
  return 1
}

current_pid() {
  P=$(cat "$PIDFILE" 2>/dev/null)
  if is_singbox_pid "$P"; then echo "$P"; return 0; fi
  find_pid
}

rotate_log() {
  SIZE=$(wc -c < "$LOG" 2>/dev/null)
  SIZE=$((SIZE + 0))
  if test "$SIZE" -gt "$LOG_MAX_BYTES"; then
    tail -n 2000 "$LOG" > "$LOG.tmp" 2>/dev/null && cat "$LOG.tmp" > "$LOG"
    rm -f "$LOG.tmp"
  fi
}

# 开机自启时 br0 可能还没创建，等待一段时间再装规则。
wait_lan() {
  N=0
  while ! ip link show "$LAN_IF" >/dev/null 2>&1; do
    N=$((N + 1))
    if test "$N" -ge "$LAN_WAIT_SECONDS"; then echo "未找到 LAN 接口 $LAN_IF"; return 1; fi
    sleep 1
  done
}

# $1 为 -I（添加）或 -D（删除）。放行面板、Mixed、DNS 重定向端口和 TProxy 标记流量，
# 否则 INPUT 链默认拒绝时局域网 DNS 和透明代理会失效。
input_rules() {
  ACT=$1
  for RULE in "tcp $DASHBOARD_PORT" "tcp $MIXED_PORT" "tcp $DNS_PORT" "udp $DNS_PORT"; do
    set -- $RULE
    if test "$ACT" = -D; then
      iptables -w 10 -D INPUT -i "$LAN_IF" -p "$1" --dport "$2" -j ACCEPT 2>/dev/null || true
    else
      iptables -w 10 -I INPUT 1 -i "$LAN_IF" -p "$1" --dport "$2" -j ACCEPT || return 1
    fi
  done
  if test "$ACT" = -D; then
    iptables -w 10 -D INPUT -i "$LAN_IF" -m mark --mark "$FWMARK" -j ACCEPT 2>/dev/null || true
  else
    iptables -w 10 -I INPUT 1 -i "$LAN_IF" -m mark --mark "$FWMARK" -j ACCEPT || return 1
  fi
}

cleanup_tproxy() {
  iptables -w 10 -t mangle -D PREROUTING -i "$LAN_IF" -j SINGBOX 2>/dev/null || true
  iptables -w 10 -t mangle -F SINGBOX 2>/dev/null || true
  iptables -w 10 -t mangle -X SINGBOX 2>/dev/null || true
  iptables -w 10 -t nat -D PREROUTING -i "$LAN_IF" -j SINGBOX_DNS 2>/dev/null || true
  iptables -w 10 -t nat -F SINGBOX_DNS 2>/dev/null || true
  iptables -w 10 -t nat -X SINGBOX_DNS 2>/dev/null || true
  # 重复删除，兼容旧版本或多次启动遗留的重复规则。
  for I in 1 2 3; do input_rules -D; done
  while ip rule del fwmark "$FWMARK" table "$ROUTE_TABLE" 2>/dev/null; do :; done
  ip route flush table "$ROUTE_TABLE" 2>/dev/null || true
}

setup_tproxy() {
  cleanup_tproxy
  wait_lan || return 1
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

  input_rules -I || return 1
}

start_service() {
  mkdir -p "$ROOT/run"
  PID=$(current_pid)
  if test -n "$PID"; then
    echo "$PID" > "$PIDFILE"
    setup_tproxy || { echo 'TProxy 规则安装失败'; return 1; }
    echo 'sing-box 已在运行，TProxy 规则已刷新'
    return 0
  fi
  "$BIN" check -c "$CONFIG" || { echo '配置校验失败'; return 1; }
  rotate_log
  nohup "$BIN" run -c "$CONFIG" >> "$LOG" 2>&1 &
  PID=$!
  echo "$PID" > "$PIDFILE"
  sleep 2
  if ! kill -0 "$PID" 2>/dev/null; then
    echo '启动失败，最近日志：'
    tail -n 15 "$LOG" 2>/dev/null
    rm -f "$PIDFILE"
    return 1
  fi
  if ! setup_tproxy; then
    echo 'TProxy 规则安装失败，已回滚'
    cleanup_tproxy
    kill "$PID" 2>/dev/null || true
    rm -f "$PIDFILE"
    return 1
  fi
  echo 'sing-box TProxy 启动成功'
}

stop_service() {
  cleanup_tproxy
  PID=$(current_pid)
  if test -z "$PID"; then
    echo 'sing-box 未运行，TProxy 规则已清理'
    rm -f "$PIDFILE"
    return 0
  fi
  kill "$PID" 2>/dev/null || true
  COUNT=0
  while kill -0 "$PID" 2>/dev/null && test "$COUNT" -lt 10; do
    sleep 1
    COUNT=$((COUNT + 1))
  done
  if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID" 2>/dev/null || true; fi
  rm -f "$PIDFILE"
  echo 'sing-box 已停止，TProxy 规则已清理'
}

case "$1" in
  start) start_service ;;
  stop) stop_service ;;
  restart) stop_service; start_service ;;
  status) current_pid >/dev/null ;;
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
    `, 900000);
    clearInterval(progressTimer);
    progress.close();
    const installLogResult = await shell(`tail -n 80 ${shQuote(INSTALL_LOG)} 2>/dev/null`, 10000);
    const installLog = installLogResult.content || '';
    await isRunning(); await refreshBootButton();
    if (!res.success) { createToast(`安装/更新失败：<br>${escapeHtml([installLog, res.content].filter(Boolean).join('\n') || '请查看安装日志')}`, 'red'); return; }
    createToast(`sing-box 已安装/更新：<br>${escapeHtml(installLog)}`, 'green');
    if (!installed) {
      // 配置可能是之前保留下来的，密钥以实际配置为准。
      const info = await panelInfo();
      await confirmDialog('singbox_installed', '安装完成',
        `默认 Mixed 代理：<b>${escapeHtml(UFI_DATA.lan_ipaddr)}:${MIXED_PORT}</b><br>` +
        `面板：<a target="_blank" href="http://${escapeHtml(UFI_DATA.lan_ipaddr)}:${info.port}/ui/">http://${escapeHtml(UFI_DATA.lan_ipaddr)}:${info.port}/ui/</a><br>` +
        `API 密钥：<code style="user-select:all">${escapeHtml(info.secret || '(未设置)')}</code><br>默认配置为直连，请编辑或上传你自己的 sing-box JSON 配置，或在“订阅设置”中填写订阅后点击“更新订阅”。`, '知道了', '');
    }
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
              <iframe id="singbox_iframe" src="about:blank" style="border:none;padding:0;margin:0;width:100%;height:500px;border-radius:10px;overflow:hidden;opacity:.85"></iframe>
            </li></ul>
          </div>
        </div>
      </div>`);
    const box = document.querySelector('#singbox_actions');
    const configInput = document.createElement('input'); configInput.type = 'file'; configInput.accept = '.json,application/json'; configInput.style.display = 'none';
    configInput.onchange = async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        if (!(await requireInstalled())) return;
        if (file.size > 2 * 1024 * 1024) return createToast('配置文件不能超过 2MB', 'red');
        await saveUploadedConfig(file);
      } finally { configInput.value = ''; }
    };
    const coreInput = document.createElement('input'); coreInput.type = 'file'; coreInput.style.display = 'none';
    coreInput.onchange = async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        if (!(await requireInstalled())) return;
        const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        if (magic[0] !== 0x7f || magic[1] !== 0x45 || magic[2] !== 0x4c || magic[3] !== 0x46) return createToast('只能上传 ELF 二进制文件', 'red');
        if (file.size > 100 * 1024 * 1024) return createToast('内核文件不能超过 100MB', 'red');
        createToast('正在上传并校验内核…');
        const source = await uploadFile(file);
        const res = await shell(`
          mv ${shQuote(source)} ${BIN}.new && chmod 755 ${BIN}.new || exit 1
          ${BIN}.new version && ${BIN}.new check -c ${CONFIG} || { rm -f ${BIN}.new; exit 2; }
          WAS_RUNNING=0; if ${SERVICE} status; then WAS_RUNNING=1; fi
          ${SERVICE} stop || { rm -f ${BIN}.new; exit 3; }
          rm -f ${BIN}.bak && mv ${BIN} ${BIN}.bak && mv ${BIN}.new ${BIN}
          if test "$WAS_RUNNING" = 0; then rm -f ${BIN}.bak; ${BIN} version | head -n 1; exit 0; fi
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
      if (!(await requireInstalled())) return;
      const res = await shell(`cat ${CONFIG}`); if (!res.success) return createToast('读取配置失败', 'red');
      const { el, close } = createFixedToast('singbox_editor', `<div style="pointer-events:all;width:86vw;max-width:850px"><div class="title" style="margin:0">编辑 sing-box JSON</div><div class="inner" style="margin:10px 0"></div><div style="text-align:right"><button class="format">格式化</button> <button class="save">校验并保存</button> <button class="cancel">关闭</button></div></div>`);
      const textarea = document.createElement('textarea'); textarea.value = res.content; textarea.spellcheck = false; textarea.style.cssText = 'width:100%;height:500px;max-height:62vh;box-sizing:border-box;background:#000d;color:#0f0;border:0;padding:8px;font-family:monospace;line-height:1.4';
      el.querySelector('.inner').appendChild(textarea); el.querySelector('.cancel').onclick = close;
      el.querySelector('.format').onclick = () => {
        try { textarea.value = JSON.stringify(JSON.parse(textarea.value), null, 2); } catch (error) { createToast(`JSON 格式错误：<br>${escapeHtml(error.message)}`, 'red'); }
      };
      el.querySelector('.save').onclick = async () => { if (!textarea.value.trim()) return createToast('配置不能为空', 'red'); if (await saveUploadedConfig(new File([textarea.value], 'config.json', { type: 'application/json' }))) close(); };
    };
    const backup = async () => {
      if (!(await requireInstalled())) return;
      // 直接在浏览器生成下载，不在上传目录留下含密钥的副本。
      const res = await shell(`cat ${CONFIG}`);
      if (!res.success) return createToast('备份失败', 'red');
      downloadText(`singbox_config_backup_${Date.now()}.json`, res.content);
    };
    const start = async () => {
      if (!(await requireInstalled())) return;
      const res = await shell(`${SERVICE} start`, 120000);
      createToast(res.success ? 'sing-box 已启动' : `启动失败：<br>${escapeHtml(res.content)}`, res.success ? 'green' : 'red'); await isRunning();
    };
    const stop = async () => {
      if (!(await requireInstalled())) return;
      const res = await shell(`${SERVICE} stop`);
      createToast(res.success ? 'sing-box 已停止' : escapeHtml(res.content), res.success ? 'green' : 'red'); await isRunning();
    };
    let uninstallClicks = 0; let uninstallTimer = null;
    const uninstall = async () => {
      uninstallClicks++; clearTimeout(uninstallTimer); uninstallTimer = setTimeout(() => { uninstallClicks = 0; }, 3000);
      if (uninstallClicks < 3) return createToast(`再点击 ${3 - uninstallClicks} 次确认卸载`, 'red');
      uninstallClicks = 0; if (!(await requireRoot())) return;
      const res = await shell(`test -x ${SERVICE} && ${SERVICE} stop 2>/dev/null; rm -rf ${ROOT}; sed -i '\\|${SERVICE} start|d' ${BOOT} 2>/dev/null; true`);
      createToast(res.success ? 'sing-box 已卸载' : `卸载失败：${escapeHtml(res.content)}`, res.success ? 'green' : 'red'); await isRunning(); await refreshBootButton();
    };
    const toggleBoot = async () => {
      if (!(await requireInstalled())) return;
      if (await isBootEnabled()) { await shell(`sed -i '\\|${SERVICE} start|d' ${BOOT}`); createToast('已取消开机自启', 'green'); }
      else { await shell(`touch ${BOOT}; grep -qxF '${SERVICE} start' ${BOOT} || echo '${SERVICE} start' >> ${BOOT}`); createToast('已设置开机自启', 'green'); }
      await refreshBootButton();
    };
    const openUrl = (url) => { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.click(); };
    const panelUrl = (port = API_PORT) => `http://${UFI_DATA.lan_ipaddr}:${port}/ui/?t=${Date.now()}`;
    const ensurePanelRunning = async () => {
      if (!(await requireInstalled())) return false;
      if (!(await isRunning())) {
        createToast('sing-box 未运行，正在启动…');
        const res = await shell(`${SERVICE} start`, 120000);
        if (!res.success) { createToast(`面板启动失败：<br>${escapeHtml(res.content || '请查看日志')}`, 'red'); return false; }
        await wait(800);
      }
      return isRunning();
    };
    const refreshPanel = async () => {
      if (!(await ensurePanelRunning())) return;
      document.querySelector('#singbox_iframe').src = panelUrl((await panelInfo()).port);
    };
    const openPanel = async () => {
      if (!(await ensurePanelRunning())) return;
      const url = panelUrl((await panelInfo()).port);
      document.querySelector('#singbox_iframe').src = url;
      openUrl(url);
    };
    const showPanelInfo = async () => {
      if (!(await requireInstalled())) return;
      const info = await panelInfo();
      await confirmDialog('singbox_panel_info', '面板信息',
        `面板地址：<b>http://${escapeHtml(UFI_DATA.lan_ipaddr)}:${info.port}/ui/</b><br>` +
        `API 地址：<b>${escapeHtml(UFI_DATA.lan_ipaddr)}</b> 端口 <b>${info.port}</b><br>` +
        `API 密钥：<code style="user-select:all">${escapeHtml(info.secret || '(未设置)')}</code><br>` +
        `Mixed 代理：<b>${escapeHtml(UFI_DATA.lan_ipaddr)}:${MIXED_PORT}</b>`, '关闭', '');
    };

    box.append(configInput, coreInput,
      makeButton('编辑配置', edit), makeButton('上传配置', () => configInput.click()), makeButton('备份配置', backup),
      makeButton('订阅设置', editSubscriptions), makeButton('更新订阅', updateSubscriptions),
      makeButton('安装/在线更新', installOrUpdate), makeButton('启动', start), makeButton('停止', stop), makeButton('重启', () => restart()),
      makeButton('卸载', uninstall), makeButton('开机自启', toggleBoot), makeButton('上传内核', () => coreInput.click()),
      makeButton('刷新面板', refreshPanel), makeButton('打开面板', openPanel), makeButton('面板信息', showPanelInfo),
      makeButton('查看日志', async () => { const res = await shell(`tail -n 200 ${shQuote(LOG)} 2>/dev/null`); showLog(res.content); }),
      makeButton('官方文档', () => openUrl('https://sing-box.sagernet.org/configuration/')),
      makeButton('刷新状态', async () => { await isRunning(); await refreshBootButton(); createToast('状态已刷新', 'green'); }));
    const buttons = [...box.querySelectorAll('button')];
    const bootButton = buttons.find((button) => button.textContent === '开机自启'); if (bootButton) bootButton.id = 'singbox_boot';
    collapseGen('#collapse_singbox_btn', '#collapse_singbox', '#collapse_singbox', async () => {
      const running = await isRunning(); await refreshBootButton();
      if (running) document.querySelector('#singbox_iframe').src = panelUrl((await panelInfo()).port);
    });
    await isRunning(); await refreshBootButton();
  })();
})();
//</script>
