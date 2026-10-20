'use strict';

/**
 * 轻量自托管账号体系（零第三方依赖）。
 *
 * - 密码：node:crypto scrypt + 随机盐，timingSafeEqual 常量时间比较
 * - 会话：随机 192-bit token，服务端会话表持久化到 data/sessions.json，
 *   30 天过期；鉴权走 Authorization: Bearer <token>
 * - 图存储：按用户隔离，持久化到 data/diagrams.json，单用户上限 200 张
 *
 * 所有 JSON 文件写入都走「读-改-全量写」，单实例场景足够；不引入 SQLite。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DIAGRAMS_PER_USER = 200;
const MAX_XML_BYTES = 2 * 1024 * 1024;

function createAccounts({ dataDir } = {}) {
  const dir = dataDir || path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });

  const usersFile = path.join(dir, 'accounts.json');
  const sessionsFile = path.join(dir, 'sessions.json');
  const diagramsFile = path.join(dir, 'diagrams.json');

  function readJson(file, fallback) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(file, obj) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  }

  const users = readJson(usersFile, { list: [] });
  const sessions = readJson(sessionsFile, {});
  const diagrams = readJson(diagramsFile, {});

  /* ---------------- 密码 ---------------- */

  function hashPassword(password, salt) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
    return { salt, hash };
  }

  function verifyPassword(password, salt, hash) {
    try {
      const candidate = crypto.scryptSync(String(password), String(salt), 32);
      const expect = Buffer.from(String(hash), 'hex');
      return candidate.length === expect.length && crypto.timingSafeEqual(candidate, expect);
    } catch {
      return false;
    }
  }

  /* ---------------- 用户 / 会话 ---------------- */

  const USERNAME_RE = /^[\w\u4e00-\u9fa5-]{2,32}$/;

  function register({ username, password }) {
    username = String(username || '').trim();
    password = String(password || '');
    if (!USERNAME_RE.test(username)) return { error: '用户名需为 2-32 位字母/数字/中文/连字符' };
    if (password.length < 6 || password.length > 128) return { error: '密码长度需为 6-128 位' };
    if (users.list.some((u) => u.username === username)) return { error: '用户名已被占用' };
    if (users.list.length >= 1000) return { error: '注册名额已满，请联系管理员' };
    const { salt, hash } = hashPassword(password);
    const user = { id: crypto.randomBytes(8).toString('hex'), username, salt, hash, createdAt: Date.now() };
    users.list.push(user);
    writeJson(usersFile, users);
    return { user: publicUser(user), token: issueToken(user) };
  }

  function login({ username, password }) {
    username = String(username || '').trim();
    const user = users.list.find((u) => u.username === username);
    // 用户不存在时也走一次哈希，抹平时间差
    const ok = user ? verifyPassword(password, user.salt, user.hash) : (hashPassword(password || 'x'), false);
    if (!ok) return { error: '用户名或密码错误' };
    return { user: publicUser(user), token: issueToken(user) };
  }

  function publicUser(u) {
    return { id: u.id, username: u.username, createdAt: u.createdAt };
  }

  function issueToken(user) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions[token] = { userId: user.id, createdAt: Date.now() };
    persistSessions();
    return token;
  }

  function persistSessions() {
    // 顺手清理过期会话
    const now = Date.now();
    for (const t of Object.keys(sessions)) {
      if (now - (sessions[t].createdAt || 0) > SESSION_TTL_MS) delete sessions[t];
    }
    writeJson(sessionsFile, sessions);
  }

  /** 解析请求头，返回 user 或 null */
  function authUser(req) {
    const h = String((req && req.headers && req.headers.authorization) || '');
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    if (!m) return null;
    const sess = sessions[m[1]];
    if (!sess) return null;
    if (Date.now() - sess.createdAt > SESSION_TTL_MS) {
      delete sessions[m[1]];
      persistSessions();
      return null;
    }
    return users.list.find((u) => u.id === sess.userId) || null;
  }

  function logout(req) {
    const h = String((req && req.headers && req.headers.authorization) || '');
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    if (m && sessions[m[1]]) {
      delete sessions[m[1]];
      persistSessions();
    }
    return { ok: true };
  }

  /* ---------------- 图存储 ---------------- */

  function summarize(xml) {
    // 避免循环依赖：不引 xml.js，仅做轻量统计
    const vertices = (String(xml).match(/\bvertex="1"/g) || []).length;
    const edges = (String(xml).match(/\bedge="1"/g) || []).length;
    return { vertices, edges };
  }

  function listDiagrams(user) {
    const list = Object.values(diagrams).filter((d) => d.userId === user.id);
    list.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    return list.map((d) => ({
      id: d.id,
      title: d.title,
      vertices: d.vertices,
      edges: d.edges,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt || d.createdAt,
    }));
  }

  function saveDiagram(user, { title, xml, id }) {
    xml = String(xml || '');
    if (!xml.trim()) return { error: '图表内容为空' };
    if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) return { error: '图表超过 2MB 上限' };
    title = String(title || '').trim().slice(0, 120) || '未命名图表';

    if (id) {
      const entry = diagrams[id];
      if (!entry || entry.userId !== user.id) return { error: '图表不存在或无权限' };
      entry.title = title;
      entry.xml = xml;
      entry.updatedAt = Date.now();
      const s = summarize(xml);
      entry.vertices = s.vertices;
      entry.edges = s.edges;
      writeJson(diagramsFile, diagrams);
      return { entry: slim(entry) };
    }

    const mine = listDiagrams(user);
    if (mine.length >= MAX_DIAGRAMS_PER_USER) return { error: '云端图库已满（' + MAX_DIAGRAMS_PER_USER + ' 张），请先清理' };
    const newId = crypto.randomBytes(8).toString('hex');
    const s = summarize(xml);
    const entry = {
      id: newId,
      userId: user.id,
      title,
      xml,
      vertices: s.vertices,
      edges: s.edges,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    diagrams[newId] = entry;
    writeJson(diagramsFile, diagrams);
    return { entry: slim(entry) };
  }

  function slim(d) {
    return { id: d.id, title: d.title, vertices: d.vertices, edges: d.edges, createdAt: d.createdAt, updatedAt: d.updatedAt || d.createdAt };
  }

  function getDiagram(user, id) {
    const entry = diagrams[String(id || '')];
    if (!entry || entry.userId !== user.id) return null;
    return entry;
  }

  function deleteDiagram(user, id) {
    const entry = diagrams[String(id || '')];
    if (!entry || entry.userId !== user.id) return false;
    delete diagrams[String(id || '')];
    writeJson(diagramsFile, diagrams);
    return true;
  }

  return {
    register,
    login,
    logout,
    authUser,
    publicUser,
    listDiagrams,
    saveDiagram,
    getDiagram,
    deleteDiagram,
    _files: { usersFile, sessionsFile, diagramsFile },
  };
}

module.exports = { createAccounts };
