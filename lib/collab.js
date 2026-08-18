/**
 * Diagram Atelier — 实时协作（零第三方依赖）
 *
 * 设计取舍（第一性思维）：
 *   - 路线图曾写「Yjs」，但架构铁律是「零第三方运行时依赖」（产品护城河）。
 *     引入 Yjs 会打破这条不可违背的规则，故改用原生 WebSocket：
 *       · 握手用 Node 内置 crypto（SHA1 + base64），不引入 ws 包；
 *       · 帧编解码自行实现（文本帧 / 掩码 / ping-pong / close）；
 *       · 协作状态以「整图 XML」为最小同步单元，复用 loadXml 作为唯一合并点，
 *         因此撤销/重做/AI 改图/远端合并全部走同一条路径，天然一致。
 *   - 房间按 shareId 划分；无账号体系时以「邀请链接 + 房间号」授权，轻量可用。
 *
 * 接入方式（双保险，跨 Node/环境一致）：
 *   在主请求 handler 顶部检测 `req.headers.upgrade` 调用 handleCollabUpgrade(req)。
 *   （部分环境下 Node 不会为 WS 请求派发 'upgrade' 事件，改为在主 handler 内拦截最稳。）
 *
 * 消息协议（JSON over WS text frame）：
 *   客户端 → 服务端
 *     { type:'hello', name }                  加入房间（name 为展示名）
 *     { type:'doc', xml }                      本地整图（loadXml 后广播）
 *     { type:'cursor', x, y }                  画布坐标光标
 *     { type:'selection', ids:[...] }          选中节点
 *   服务端 → 客户端
 *     { type:'welcome', clientId, peers:[{id,name,color}] }
 *     { type:'peer-join', id, name, color }
 *     { type:'peer-leave', id }
 *     { type:'doc', xml, from }                远端整图
 *     { type:'cursor', id, x, y, name, color }
 *     { type:'selection', id, ids, color }
 */

const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const COLORS = ['#e6492d', '#1c7ed6', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599', '#e8590c', '#5f3dc4'];

/* ── 帧编解码（RFC 6455 最小实现，仅支持文本帧 + 控制帧） ── */

function encodeFrame(str, opcode = 0x1) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

// 解析缓冲区中的完整帧；返回 { frames:[{opcode,payload}], rest:Buffer }
function parseFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let pos = offset + 2;
    if (len === 126) {
      if (pos + 2 > buffer.length) break;
      len = buffer.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (pos + 8 > buffer.length) break;
      len = Number(buffer.readBigUInt64BE(pos));
      pos += 8;
    }
    let maskKey;
    if (masked) {
      if (pos + 4 > buffer.length) break;
      maskKey = buffer.subarray(pos, pos + 4);
      pos += 4;
    }
    if (pos + len > buffer.length) break;
    let payload = buffer.subarray(pos, pos + len);
    if (masked) {
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
      payload = out;
    } else {
      payload = Buffer.from(payload);
    }
    frames.push({ opcode, payload });
    pos += len;
    offset = pos;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/* ── 房间与客户端 ── */

class Room {
  constructor(id) {
    this.id = id;
    this.clients = new Map(); // clientId -> { socket, name, color, cursor }
    this._colorIdx = 0;
  }
  add(clientId, info) {
    const color = COLORS[this._colorIdx % COLORS.length];
    this._colorIdx++;
    const entry = { ...info, color };
    this.clients.set(clientId, entry);
    return entry;
  }
  remove(clientId) {
    return this.clients.delete(clientId);
  }
  peers(exceptId) {
    const out = [];
    for (const [id, c] of this.clients) {
      if (id === exceptId) continue;
      out.push({ id, name: c.name, color: c.color });
    }
    return out;
  }
  broadcast(msg, exceptId) {
    const data = encodeFrame(JSON.stringify(msg));
    for (const [id, c] of this.clients) {
      if (id === exceptId) continue;
      try { c.socket.write(data); } catch (_) { /* ignore broken socket */ }
    }
  }
  send(clientId, msg) {
    const c = this.clients.get(clientId);
    if (!c) return;
    try { c.socket.write(encodeFrame(JSON.stringify(msg))); } catch (_) {}
  }
}

class CollabHub {
  constructor() {
    this.rooms = new Map(); // roomId -> Room
  }
  getRoom(roomId) {
    let r = this.rooms.get(roomId);
    if (!r) { r = new Room(roomId); this.rooms.set(roomId, r); }
    return r;
  }
  dropEmpty(roomId) {
    const r = this.rooms.get(roomId);
    if (r && r.clients.size === 0) this.rooms.delete(roomId);
  }
}

const defaultHub = new CollabHub();

// 在主请求 handler 内拦截 WS 升级请求时调用：req 为 IncomingMessage，握手用 req.socket
function handleCollabUpgrade(req) {
  const socket = req.socket;
  let url;
  try { url = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
  catch (_) { socket.destroy(); return; }
  if (url.pathname !== '/collab') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.setNoDelay(true);

  const roomId = url.searchParams.get('room') || 'default';
  const clientId = crypto.randomUUID();
  const room = defaultHub.getRoom(roomId);
  let self = null;

  const finish = () => {
    if (self) room.remove(clientId);
    room.broadcast({ type: 'peer-leave', id: clientId }, clientId);
    defaultHub.dropEmpty(roomId);
  };

  socket.on('error', finish);
  socket.on('close', finish);

  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let parsed;
    try { parsed = parseFrames(buf); } catch (_) { socket.destroy(); return; }
    buf = parsed.rest;
    for (const f of parsed.frames) {
      if (f.opcode === 0x8) { // close
        socket.end();
        return;
      }
      if (f.opcode === 0x9) { // ping → pong
        try { socket.write(encodeFrame('', 0xA)); } catch (_) {}
        continue;
      }
      if (f.opcode !== 0x1) continue; // 仅处理文本帧
      let msg;
      try { msg = JSON.parse(f.payload.toString('utf8')); } catch (_) { continue; }
      if (!msg || typeof msg.type !== 'string') continue;

      if (msg.type === 'hello') {
        const name = String(msg.name || '匿名').slice(0, 24);
        self = room.add(clientId, { socket, name, cursor: null });
        room.send(clientId, { type: 'welcome', clientId, peers: room.peers(clientId) });
        room.broadcast({ type: 'peer-join', id: clientId, name, color: self.color }, clientId);
      } else if (!self) {
        continue; // 必须先 hello
      } else if (msg.type === 'doc') {
        room.broadcast({ type: 'doc', xml: String(msg.xml || ''), from: clientId }, clientId);
      } else if (msg.type === 'cursor') {
        self.cursor = { x: msg.x, y: msg.y };
        room.broadcast({ type: 'cursor', id: clientId, x: msg.x, y: msg.y, name: self.name, color: self.color }, clientId);
      } else if (msg.type === 'selection') {
        room.broadcast({ type: 'selection', id: clientId, ids: Array.isArray(msg.ids) ? msg.ids : [], color: self.color }, clientId);
      }
    }
  });
}

module.exports = { handleCollabUpgrade, CollabHub, encodeFrame, parseFrames, WS_GUID };
