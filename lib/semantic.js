'use strict';

/**
 * Diagram Atelier — 中文语义理解（Node 侧入口）
 *
 * 浏览器端实现位于 public/semantic.js（index.html 引用 ./semantic.js），
 * 本文件作为 Node 侧（单元测试 / 未来服务端语义增强）的统一入口，
 * 直接复用同一份实现，确保「单一真相来源」，避免 lib 与 public 两份文件漂移。
 */

module.exports = require('../public/semantic.js');
