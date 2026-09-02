// 用 Float 项目里真实的 JSZip 打开转换器产出的 ZIP，再跑一遍 backup.ts 里
// 逐字复制的校验谓词，确认导入端不会拒收。converter.test.mjs 里的 ZIP 往返用的是
// 转换器自己的读取函数，验证不了字节格式本身，所以才需要这一遍真库校验。
// 需要 Float 项目已 npm install；找不到就直接跳过，不让它变成假报错。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const floatRoot = new URL('../Float 小手机/ai-virtual-phone-main/', import.meta.url);
let JSZip;
try {
  JSZip = createRequire(floatRoot)('jszip');
} catch {
  console.log('跳过：没找到 Float 项目的 jszip（先在 Float 目录跑 npm install）');
  process.exit(0);
}

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

const element = () => ({
  addEventListener() {}, classList: { add() {}, remove() {} },
  style: {}, textContent: '', disabled: false, files: [],
});
const elements = new Map();
const context = vm.createContext({
  console,
  document: {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    querySelector() { return { value: 'ephone' }; },
    createElement: element,
    body: { appendChild() {}, removeChild() {} },
  },
  window: globalThis,
  Blob, Response, TextDecoder, TextEncoder, Uint8Array, DataView,
  DecompressionStream, CompressionStream, btoa, atob, URL, setTimeout, clearTimeout,
});
vm.runInContext(source, context);

// ---- backup.ts 的校验谓词（逐字搬运） ----
const SUPPORTED_BACKUP_VERSIONS = new Set([1, 2]);
const isFiniteNonNegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function isBackupManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return false;
  return manifest.format === 'ai-phone-backup'
    && SUPPORTED_BACKUP_VERSIONS.has(Number(manifest.version))
    && typeof manifest.createdAt === 'string'
    && Number.isFinite(Date.parse(manifest.createdAt))
    && isFiniteNonNegative(manifest.totalBytes)
    && isFiniteNonNegative(manifest.totalRecords)
    && Array.isArray(manifest.modules)
    && manifest.modules.every((item) => item
      && typeof item.id === 'string'
      && typeof item.label === 'string'
      && isFiniteNonNegative(item.records)
      && isFiniteNonNegative(item.bytes));
}

function isSourceBackup(source) {
  if (!source || typeof source !== 'object') return false;
  if (source.type === 'kv' || source.type === 'localStorage') {
    return Array.isArray(source.records)
      && source.records.every((r) => r && typeof r.key === 'string' && typeof r.value === 'string');
  }
  if (source.type !== 'indexeddb' || typeof source.dbName !== 'string' || !Array.isArray(source.stores)) return false;
  return source.stores.every((s) => s && typeof s.name === 'string' && Array.isArray(s.records));
}

function isModulePayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return typeof payload.moduleId === 'string'
    && Array.isArray(payload.sources)
    && payload.sources.length > 0
    && payload.sources.every(isSourceBackup);
}

// Float 侧还会用 DATA_MODULES 的 id 去匹配模块，模块 id 必须是已知的
const KNOWN_MODULE_IDS = new Set(['chat', 'settings', 'characters', 'desktop', 'memory',
  'social', 'apps', 'resource_hub', 'creative', 'cache']);

const ephone = {
  version: 3,
  timestamp: 1,
  data: {
    chats: [
      { id: 'c1', name: '阿糯', avatar: 'data:image/png;base64,AAAA', isGroup: false,
        settings: { aiPersona: '温柔', myPersona: '用户设定' },
        history: [
          { id: 'old-1', role: 'user', content: '你好', timestamp: 10 },
          { id: 'old-2', role: 'assistant', content: '你好呀', timestamp: 11 },
        ] },
      { id: 'g1', name: '测试群', isGroup: true, members: ['c1'],
        history: [{ role: 'assistant', charId: 'c1', content: '群里见', timestamp: 12 }] },
    ],
    worldBooks: [{ id: 'wb', name: '设定', content: [{ keys: ['城'], content: '天空城' }] }],
  },
};

const blob = await context.toFloatBackup('ephone', ephone);
const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
console.log('entries:', Object.keys(zip.files));

const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
assert.ok(isBackupManifest(manifest), 'manifest 未通过 Float 的 isBackupManifest');
console.log('manifest ok:', JSON.stringify(manifest, null, 2));

const names = Object.keys(zip.files).filter((n) => n.startsWith('modules/') && n.endsWith('.json'));
assert.ok(names.length > 0, '没有模块文件');
for (const name of names) {
  const payload = JSON.parse(await zip.file(name).async('string'));
  assert.ok(isModulePayload(payload), `${name} 未通过 isModulePayload`);
  assert.ok(KNOWN_MODULE_IDS.has(payload.moduleId), `${name}: 未知模块 id ${payload.moduleId}`);
  console.log(`${name} ok — moduleId=${payload.moduleId}, sources=${payload.sources.length}`);
}

// 中文文件名/内容要能正确解出来（UTF-8 标志位）
const chat = JSON.parse(await zip.file('modules/chat/000.json').async('string'));
const sessions = chat.sources[0].stores.find((s) => s.name === 'sessions');
console.log('sessions:', JSON.stringify(sessions.records.map((r) => r.value), null, 2));

console.log('\nfloat zip verified against real JSZip');
