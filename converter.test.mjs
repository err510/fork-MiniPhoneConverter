import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, 'index.html should contain a script');
const fileInputTag = html.match(/<input\s+id="backup-file"[^>]*>/)?.[0];
assert.ok(fileInputTag, 'index.html should contain the backup file input');
assert.doesNotMatch(fileInputTag, /\saccept=/i, '.ee must not be blocked by the native file picker');

const elements = new Map();
const element = () => ({
  addEventListener() {},
  classList: { add() {}, remove() {} },
  style: {},
  textContent: '',
  disabled: false,
  files: [],
});
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  },
  querySelector() { return { value: 'ephone' }; },
  createElement: element,
  body: { appendChild() {}, removeChild() {} },
};
const context = vm.createContext({
  console,
  document,
  window: globalThis,
  Blob,
  Response,
  TextDecoder,
  TextEncoder,
  Uint8Array,
  DataView,
  DecompressionStream,
  CompressionStream,
  btoa,
  atob,
  URL,
  setTimeout,
  clearTimeout,
});
new vm.Script(source, { filename: 'index.html' }).runInContext(context);

const ephone = {
  version: 3,
  timestamp: 1,
  data: {
    chats: [
      {
        id: 'c1', name: '阿糯', avatar: 'avatar.png', isGroup: false,
        settings: { aiPersona: '温柔', myPersona: '用户设定' },
        history: [
          { id: 'old-1', role: 'user', content: '你好', timestamp: 10 },
          { id: 'old-2', role: 'assistant', content: '你好呀', timestamp: 11 },
        ],
      },
      {
        id: 'g1', name: '测试群', isGroup: true, members: ['c1'],
        history: [{ role: 'assistant', charId: 'c1', content: '群里见', timestamp: 12 }],
      },
    ],
    worldBooks: [{ id: 'wb', name: '设定', content: [{ keys: ['城'], content: '天空城' }] }],
  },
};

const hand = context.toSullyBackup('sully-hand', 'ephone', ephone);
assert.equal(hand.version, 3);
assert.equal(hand.characters.length, 1);
assert.equal(hand.groups.length, 1);
assert.equal(hand.messages.length, 3);
assert.equal(hand.messages[2].groupId, 'g1');
assert.equal(hand.worldbooks[0].content, '天空城');
assert.equal(hand.vectorMemories, undefined);
assert.equal(hand.extraLocalStorageConfig, undefined);

const csy = context.toSullyBackup('sully-csy', 'sully-hand', {
  ...hand,
  memoryNodes: [{ id: 'n1' }],
  characterGroups: [{ id: 'cg1' }],
});
assert.equal(csy.version, 2);
assert.equal(csy.characters.length, 1);
assert.equal(csy.messages.length, 3);
assert.equal(csy.memoryNodes, undefined);
assert.equal(csy.characterGroups, undefined);

const handFromCsy = context.toSullyBackup('sully-hand', 'sully-csy', {
  ...csy,
  vectorMemories: [{ id: 'vm1' }],
  extraLocalStorageConfig: { token: 'secret' },
});
assert.equal(handFromCsy.version, 3);
assert.equal(handFromCsy.vectorMemories, undefined);
assert.equal(handFromCsy.extraLocalStorageConfig, undefined);

const ephoneAgain = context.toEphoneCompatible('sully-hand', hand);
assert.equal(ephoneAgain.data.chats.length, 2);
assert.equal(ephoneAgain.data.chats[0].history.length, 2);
assert.equal(ephoneAgain.data.chats[1].history.length, 1);

function storedZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(files)) {
    const filename = Buffer.from(name);
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const pngBytes = Buffer.from([1, 2, 3, 4]);
const csyZip = storedZip({
  'data.json': JSON.stringify({
    version: 2,
    timestamp: 2,
    characters: [{ id: 'c1', name: '阿糯', avatar: 'assets/a.png' }],
    messages: [],
  }),
  'assets/a.png': pngBytes,
});
const csyRead = await context.readZipBackup({ arrayBuffer: async () => csyZip });
assert.equal(csyRead.format, 'sully-csy');
assert.equal(csyRead.data.characters[0].avatar, 'data:image/png;base64,AQIDBA==');

const handZip = storedZip({
  'manifest.json': JSON.stringify({
    formatVersion: 2,
    stores: { characters: { parts: 1, count: 1 }, messages: { parts: 1, count: 0 } },
  }),
  'metadata.json': JSON.stringify({ version: 3, timestamp: 3 }),
  'stores/characters.000.json': JSON.stringify([{ id: 'c2', name: '手抓角色' }]),
  'stores/messages.000.json': '[]',
});
const handRead = await context.readZipBackup({ arrayBuffer: async () => handZip });
assert.equal(handRead.format, 'sully-hand');
assert.equal(handRead.data.characters[0].name, '手抓角色');

const nuojiji = {
  version: 5,
  data: {
    structuredDB: {
      characters: [
        { id: 'dante', name: 'Dante', description: '天文学家', imageRef: 1 },
        { id: 'charlie', name: 'Charlie', description: '酒吧老板', image: 'https://example.test/charlie.png' },
      ],
      users: [{ id: 'Niki', name: 'Niki', avatarRef: 2 }],
      imageStore: [
        { id: 1, data: 'data:image/png;base64,ZA==' },
        { id: 2, data: 'data:image/png;base64,dQ==' },
      ],
      globalSettings: [{ key: 'apiSettings', value: {
        mainApiUrl: 'https://private.example', mainApiKey: 'sk-secret', mainApiModel: 'model-a',
      } }],
      messages: [
        { characterId: 'dante', sender: 'me', text: '你好', timestamp: 1 },
        { characterId: 'g1', sender: 'them', senderCharId: 'dante', text: '群里好', timestamp: 2 },
        { characterId: 'charlie', groupId: 'g1', sender: 'them', text: '我也在', timestamp: 3 },
      ],
      groupChats: [{ groups: [{ id: 'g1', name: '测试群', members: ['dante', 'charlie'] }] }],
      worldBooks: [{ id: 'wb1', title: '设定', entries: [{ uid: 'e1', keys: '关键词', name: '条目', content: '内容' }] }],
    },
  },
};

assert.equal(context.isNuojijiBackup(nuojiji), true);
const nuojijiRead = await context.readBackup({
  name: 'nuojiji_backup.json',
  text: async () => JSON.stringify(nuojiji),
});
assert.equal(nuojijiRead.format, 'nuojiji');
const nuojijiEphone = context.toEphoneCompatible('nuojiji', nuojiji).data;
assert.equal(nuojijiEphone.chats.length, 3);
assert.equal(nuojijiEphone.chats[0].history[0].role, 'user');
assert.equal(nuojijiEphone.chats[2].history.length, 2);
assert.equal(nuojijiEphone.chats[2].history[1].senderId, 'charlie');
assert.equal(nuojijiEphone.apiConfig.mainApiKey, 'sk-secret');
assert.equal(nuojijiEphone.apiConfig.mainApiUrl, 'https://private.example');
const nuojijiOctopus = context.toOctopusBackup('nuojiji', nuojiji);
assert.equal(nuojijiOctopus.characters.length, 2);
assert.equal(nuojijiOctopus.groups[0].history.length, 2);
assert.equal(nuojijiOctopus.worldBooks[0].content, '[备注: 条目]\n[关键词: 关键词]\n内容');

const reverseNuojiji = context.toNuojijiBackup('ephone', nuojijiEphone);
assert.equal(reverseNuojiji.version, 5);
assert.equal(reverseNuojiji.data.structuredDB.characters.length, 2);
assert.equal(reverseNuojiji.data.structuredDB.groups?.length || 0, 0);
assert.equal(reverseNuojiji.data.structuredDB.messages.length, 3);
assert.equal(reverseNuojiji.data.structuredDB.groupChats[0].groups.length, 1);
assert.equal(reverseNuojiji.data.structuredDB.messages[2].groupId, 'g1');
assert.equal(reverseNuojiji.data.structuredDB.globalSettings[0].value.mainApiKey, 'sk-secret');

const reverseFromOctopus = context.toNuojijiBackup('octopus', {
  ...nuojijiOctopus,
  characters: nuojijiOctopus.characters,
  groups: nuojijiOctopus.groups,
});
assert.equal(reverseFromOctopus.data.structuredDB.characters.length, 2);
assert.equal(reverseFromOctopus.data.structuredDB.groupChats[0].groups.length, 1);

console.log('converter tests passed');
