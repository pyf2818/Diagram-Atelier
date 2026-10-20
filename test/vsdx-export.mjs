'use strict';

/**
 * draw.io -> .vsdx 反向导出端到端测试。
 * 核心闭环：draw.io XML --drawioToVsdx--> .vsdx 字节流 --vsdxToDrawio--> draw.io XML，
 * 验证顶点/连线数量、文本、几何位置、胶接关系全链路一致（自举 round-trip）。
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const exporter = require(path.join(ROOT, 'lib', 'vsdx-export.js'));
const visio = require(path.join(ROOT, 'lib', 'visio.js'));
const { validateXml } = require(path.join(ROOT, 'lib', 'xml.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra ? '  -> ' + extra : ''));
  }
}

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="atelier">
  <diagram id="d1" name="页面-1">
    <mxGraphModel dx="1422" dy="798" grid="1" gridSize="10" page="1" pageWidth="1654" pageHeight="1169">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="title" value="订单流程" style="text;html=1;fontSize=20;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="300" height="40" as="geometry" />
        </mxCell>
        <mxCell id="a" value="开始" style="rounded=1;html=1;" vertex="1" parent="1">
          <mxGeometry x="40" y="120" width="160" height="60" as="geometry" />
        </mxCell>
        <mxCell id="b" value="库存&lt;br&gt;校验" style="rhombus;html=1;rotation=15;" vertex="1" parent="1">
          <mxGeometry x="280" y="100" width="140" height="80" as="geometry" />
        </mxCell>
        <mxCell id="c" value="发货" style="rounded=1;html=1;" vertex="1" parent="1">
          <mxGeometry x="520" y="120" width="160" height="60" as="geometry" />
        </mxCell>
        <mxCell id="e1" value="下一步" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="a" target="b">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e2" value="通过" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="b" target="c">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

console.log('\n[Visio 反向导出 drawioToVsdx]');

console.log('\n— parseModel —');
const model = exporter.parseModel(SAMPLE);
ok('解析出 4 个顶点（含标题文本）', model.vertices.length === 4, String(model.vertices.length));
ok('解析出 2 条连线', model.edges.length === 2, String(model.edges.length));
ok('顶点 a 文本=开始', model.vertices[1].label === '开始', model.vertices[1].label);
ok('HTML 换行标签转成换行符', model.vertices[2].label === '库存\n校验', JSON.stringify(model.vertices[2].label));
ok('rotation 样式解析为 15', model.vertices[2].rotation === 15, String(model.vertices[2].rotation));
ok('连线 e1 带胶接 source=a', model.edges[0].source === 'a' && model.edges[0].target === 'b');

console.log('\n— zipSync —');
const tinyZip = exporter.zipSync([{ name: 'a.txt', data: Buffer.from('hello zip') }]);
ok('zip 头签名 0x04034b50', tinyZip.readUInt32LE(0) === 0x04034b50);
ok('EOCD 签名存在', tinyZip.readUInt32LE(tinyZip.length - 22) === 0x06054b50);
const visio2 = require(path.join(ROOT, 'lib', 'visio.js'));
const back = visio2.parseZip(tinyZip);
ok('自身 parseZip 可解 zipSync 产物', back['a.txt'] && back['a.txt'].toString() === 'hello zip');

console.log('\n— drawioToVsdx —');
const out = exporter.drawioToVsdx(SAMPLE, { title: '订单流程' });
ok('导出成功无错误', !out.error, out.error);
ok('产出 Buffer', Buffer.isBuffer(out.buffer) && out.buffer.length > 0);
ok('summary: 4 顶点 + 2 连线', out.summary.vertices === 4 && out.summary.edges === 2, JSON.stringify(out.summary));
ok('页面尺寸不小于 A4 宽', out.summary.pageWidthIn >= 8.27, String(out.summary.pageWidthIn));

console.log('\n— round-trip：.vsdx -> draw.io —');
const rt = visio.vsdxToDrawio(out.buffer, { name: 'roundtrip' });
ok('round-trip 输出合法 XML', rt.validation.ok, JSON.stringify(rt.validation.errors));
ok('round-trip 顶点数一致', rt.summary.shapes === 4, JSON.stringify(rt.summary));
ok('round-trip 连线数一致', rt.summary.edges === 2, JSON.stringify(rt.summary));
ok('round-trip 保留文本「开始」', rt.xml.includes('开始'));
ok('round-trip 保留换行文本', rt.xml.includes('库存'));
ok('round-trip 保留 rotation=15', /rotation=15;/.test(rt.xml));
ok('round-trip 保留胶接（source 指向开始）', /source="v2"[\s\S]{0,200}?target="v3"|id="e4"[^>]*source="v2"/.test(rt.xml), rt.xml.match(/<mxCell[^>]*edge="1"[^>]*>/g)?.join(' | '));

console.log('\n— 健壮性 —');
const empty = exporter.drawioToVsdx('<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>');
ok('空图给出错误信息', !!empty.error, empty.error);
const garbage = exporter.drawioToVsdx('<<<not xml');
ok('非法输入不崩溃', !!garbage.error || Buffer.isBuffer(garbage.buffer));

const rtValid = validateXml(rt.xml);
ok('round-trip XML validateXml 通过', rtValid.ok, JSON.stringify(rtValid.errors));

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
