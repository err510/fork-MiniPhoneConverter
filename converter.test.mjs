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

// ===== 弯弯小手机 =====

const wanwan = {
  version: 1,
  exportedAt: 1700000000000,
  appName: '弯弯',
  config: [
    { key: 'apiSettings', value: { mainApiKey: 'sk-wanwan' } },
    { key: 'lorebooks', value: [{
      id: 'lb1', name: '天空城', scope: 'global', charIds: [], enabled: true,
      entries: [
        { id: 'e1', title: '城主', content: '城主姓白', keywords: ['城主', '白'], position: 'middle', enabled: true },
        { id: 'e2', title: '禁忌', content: '夜里不许出城', keywords: [], position: 'after', enabled: false },
      ],
    }] },
  ],
  characters: [
    { id: 1, type: 'user', name: '我', nick: '小我', description: '玩家人设', avatar: 'me.png' },
    { id: 2, type: 'char', name: '弯弯', nick: '弯弯酱', description: '开朗', avatar: 'wan.png' },
    { id: 3, type: 'char', name: '阿绿', description: '沉稳', avatar: 'lv.png' },
  ],
  chats: [{ id: 11, charId: 2, ownerUid: 1, createdAt: 100 }],
  messages: [
    { id: 1, chatId: 11, charId: 2, role: 'user', content: '在吗', createdAt: 110 },
    { id: 2, chatId: 11, charId: 2, role: 'assistant', content: '在的', createdAt: 120 },
    { id: 3, chatId: 11, charId: 2, role: 'user', content: '__IMG__data:image/png;base64,AAA', createdAt: 130 },
  ],
  groupChats: [{ id: 21, name: '三人行', ownerUid: 1, ownerId: 1, members: [2, 3, 1], avatar: 'g.png', createdAt: 90 }],
  groupMessages: [
    { id: 1, groupId: 21, senderId: 1, role: 'user', content: '晚上吃什么', createdAt: 200 },
    { id: 2, groupId: 21, senderId: 3, role: 'assistant', content: '火锅', createdAt: 210 },
  ],
  stickers: [{ id: 1, name: '笑', image: 'sticker.png' }],
  localStorage: {},
};

assert.equal(context.isWanwanBackup(wanwan), true);
assert.equal(context.isWanwanBackup(ephone), false);

const wanwanStats = context.collectStats('wanwan', wanwan);
assert.equal(wanwanStats.characters, 2, 'type:user 不该算成联系人');
assert.equal(wanwanStats.groups, 1);
assert.equal(wanwanStats.messages, 5);
assert.equal(wanwanStats.worldBooks, 1);

const wanwanEphone = context.toEphoneCompatible('wanwan', wanwan).data;
assert.equal(wanwanEphone.chats.length, 2);
const wanwanPrivate = wanwanEphone.chats.find((chat) => !chat.isGroup);
assert.equal(wanwanPrivate.name, '弯弯酱');
assert.equal(wanwanPrivate.history.length, 3);
assert.equal(wanwanPrivate.history[0].role, 'user');
assert.equal(wanwanPrivate.history[2].content, 'data:image/png;base64,AAA', '__IMG__ 前缀应被剥掉');
const wanwanGroup = wanwanEphone.chats.find((chat) => chat.isGroup);
assert.equal(wanwanGroup.members.length, 2, '群成员不应包含用户自己');
assert.equal(wanwanGroup.history.length, 2);
assert.equal(wanwanGroup.history[1].senderName, '阿绿');
assert.equal(wanwanEphone.globalSettings[0].name, '小我');
assert.equal(wanwanEphone.worldBooks.length, 1, '弯弯的世界书要带过来');
assert.equal(wanwanEphone.worldBooks[0].name, '天空城');
assert.deepEqual(wanwanEphone.worldBooks[0].content[0].keys, ['城主', '白']);
assert.equal(wanwanEphone.worldBooks[0].content[0].comment, '城主');
assert.equal(wanwanEphone.worldBooks[0].content[1].enabled, false, '禁用状态不能丢');

// ephone → 弯弯
const toWanwan = context.toWanwanBackup('ephone', ephone);
assert.equal(toWanwan.version, 1);
assert.equal(toWanwan.appName, '弯弯');
assert.equal(toWanwan.characters[0].type, 'user');
assert.equal(toWanwan.characters.length, 2, '用户 + 1 个角色');
assert.equal(toWanwan.chats.length, 1);
assert.equal(toWanwan.messages.length, 2);
assert.equal(toWanwan.messages[0].role, 'user');
assert.equal(toWanwan.groupChats.length, 1);
assert.ok(toWanwan.groupChats[0].members.includes(toWanwan.characters[0].id), '群成员应含用户');
assert.equal(toWanwan.groupMessages.length, 1);
assert.equal(toWanwan.groupMessages[0].senderId, toWanwan.characters[1].id);
// 弯弯是流式解析导入的，读到任何一张表之前必须先见到 version 和 appName，
// 否则它会直接报「备份头部无效或字段顺序不受支持」。键序是硬约束，不是风格问题。
const wanwanKeys = Object.keys(toWanwan);
assert.ok(wanwanKeys.indexOf('version') < wanwanKeys.indexOf('config'), 'version 必须在任何表之前');
assert.ok(wanwanKeys.indexOf('appName') < wanwanKeys.indexOf('config'), 'appName 必须在任何表之前');
assert.deepEqual(
  wanwanKeys.filter((key) => !['version', 'exportedAt', 'appName', 'localStorage'].includes(key)),
  ['config', 'characters', 'chats', 'messages', 'groupChats', 'groupMessages',
    'moments', 'finance', 'offlineChats', 'stickers', 'stickerCategories', 'memories',
    'memoryRuns', 'callRecords', 'smsConversations', 'smsMessages', 'imageBlobs',
    'doorModules', 'doorResults', 'avgSaves', 'avgConfigs', 'mcpServers', 'mcpToolTraces'],
  '表名要跟弯弯 data-stream.js 里的 TABLES 完全一致');

// 世界书要落到 config 的 lorebooks 键，弯弯就是从那里读的
const toWanwanLore = toWanwan.config.find((row) => row.key === 'lorebooks')?.value;
assert.equal(toWanwanLore.length, 1);
assert.equal(toWanwanLore[0].name, '设定');
assert.equal(toWanwanLore[0].scope, 'global');
assert.deepEqual(toWanwanLore[0].entries[0].keywords, ['城']);
assert.equal(toWanwanLore[0].entries[0].content, '天空城');
assert.equal(toWanwanLore[0].entries[0].position, 'middle');

// 世界书往返：弯弯 → ephone → 弯弯，条目内容与关键词不应丢
const loreRoundTrip = context.toWanwanBackup('ephone', context.toEphoneCompatible('wanwan', wanwan))
  .config.find((row) => row.key === 'lorebooks')?.value;
assert.equal(loreRoundTrip[0].name, '天空城');
assert.deepEqual(loreRoundTrip[0].entries.map((entry) => entry.content), ['城主姓白', '夜里不许出城']);
assert.deepEqual(loreRoundTrip[0].entries[0].keywords, ['城主', '白']);
assert.equal(loreRoundTrip[0].entries[1].enabled, false);

// 弯弯 → 弯弯（同格式直通）
const wanwanRoundTrip = context.toWanwanBackup('wanwan', wanwan);
assert.equal(wanwanRoundTrip.characters.length, 3);

// 弯弯 → 章鱼机 / 糯米机，确认能走完整条链路
const wanwanOctopus = context.toOctopusBackup('wanwan', wanwan);
assert.equal(wanwanOctopus.characters.length, 1);
assert.equal(wanwanOctopus.groups.length, 1);
const wanwanSully = context.toSullyBackup('sully-hand', 'wanwan', wanwan);
assert.equal(wanwanSully.version, 3);
assert.equal(wanwanSully.messages.length, 5);

// ===== Float 小手机 =====

const floatData = {
  __float: true,
  version: 1,
  idb: {
    AiPhoneChatDB: {
      messages: [
        { id: 'm1', sessionId: 's1', role: 'user', content: '早', createdAt: '2024-01-01T00:00:00.000Z', order: 0 },
        { id: 'm2', sessionId: 's1', role: 'assistant', content: '早安', createdAt: '2024-01-01T00:01:00.000Z', order: 1 },
        { id: 'm3', sessionId: 's1', role: 'tool', content: '{}', createdAt: '2024-01-01T00:02:00.000Z', order: 2 },
        { id: 'm4', sessionId: 's2', role: 'assistant', characterId: 'ch2', content: '群消息', createdAt: '2024-01-01T00:03:00.000Z', order: 0 },
      ],
      sessions: [
        { id: 's1', contactId: 'ct1', unreadCount: 0, updatedAt: '2024-01-01T00:01:00.000Z', isPinned: false },
        { id: 's2', contactId: '', unreadCount: 0, updatedAt: '2024-01-01T00:03:00.000Z', isPinned: false,
          isGroup: true, groupName: 'Float 群', participantIds: ['ch1', 'ch2'] },
      ],
      contacts: [{ id: 'ct1', characterId: 'ch1', nickname: '小浮', addedAt: '2024-01-01T00:00:00.000Z' }],
    },
    AiPhoneSettingsDB: {
      worldBooks: [{
        id: 'fwb1', name: '漂浮之城', description: '', createdAt: 1, updatedAt: 1,
        entries: [
          { uid: 'e1', key: '云,城', content: '城在云上', comment: '设定', disable: false,
            position: 'before_char', insertion_order: 10 },
          { uid: 'e2', key: '', content: '禁飞区', comment: '规则', disable: true,
            position: 'before_char', insertion_order: 20 },
        ],
      }],
    },
  },
  kv: {
    ai_phone_characters_v1: [
      { id: 'ch1', name: '浮浮', avatar: 'f1.png', persona: '安静', createdAt: 'x', updatedAt: 'x' },
      { id: 'ch2', name: '游游', avatar: 'f2.png', persona: '活泼', createdAt: 'x', updatedAt: 'x' },
      { id: 'ch3', name: '没聊过', avatar: null, persona: '孤独', createdAt: 'x', updatedAt: 'x' },
    ],
    ai_phone_user_identities_v1: [{ id: 'u1', name: '主人', avatar: 'u.png', persona: '我的设定' }],
  },
  localStorage: {},
  characters: [
    { id: 'ch1', name: '浮浮', avatar: 'f1.png', persona: '安静', createdAt: 'x', updatedAt: 'x' },
    { id: 'ch2', name: '游游', avatar: 'f2.png', persona: '活泼', createdAt: 'x', updatedAt: 'x' },
    { id: 'ch3', name: '没聊过', avatar: null, persona: '孤独', createdAt: 'x', updatedAt: 'x' },
  ],
  contacts: [{ id: 'ct1', characterId: 'ch1', nickname: '小浮', addedAt: '2024-01-01T00:00:00.000Z' }],
  sessions: [
    { id: 's1', contactId: 'ct1', unreadCount: 0, updatedAt: '2024-01-01T00:01:00.000Z', isPinned: false },
    { id: 's2', contactId: '', unreadCount: 0, updatedAt: '2024-01-01T00:03:00.000Z', isPinned: false,
      isGroup: true, groupName: 'Float 群', participantIds: ['ch1', 'ch2'] },
  ],
  messages: [
    { id: 'm1', sessionId: 's1', role: 'user', content: '早', createdAt: '2024-01-01T00:00:00.000Z', order: 0 },
    { id: 'm2', sessionId: 's1', role: 'assistant', content: '早安', createdAt: '2024-01-01T00:01:00.000Z', order: 1 },
    { id: 'm3', sessionId: 's1', role: 'tool', content: '{}', createdAt: '2024-01-01T00:02:00.000Z', order: 2 },
    { id: 'm4', sessionId: 's2', role: 'assistant', characterId: 'ch2', content: '群消息', createdAt: '2024-01-01T00:03:00.000Z', order: 0 },
  ],
};

assert.equal(context.isFloatManifest({ format: 'ai-phone-backup', version: 2, modules: [] }), true);
assert.equal(context.isFloatManifest({ formatVersion: 2, stores: {} }), false);

const floatEphone = context.toEphoneCompatible('float', floatData).data;
// 两个会话 + 两张没有单聊会话的角色卡（ch2 只在群里、ch3 完全没聊过）
assert.equal(floatEphone.chats.length, 4);
const floatPrivate = floatEphone.chats.find((chat) => chat.id === 's1');
assert.equal(floatPrivate.name, '小浮');
assert.equal(floatPrivate.history.length, 2, 'tool 消息应被滤除');
assert.equal(floatPrivate.history[0].role, 'user');
const floatGroup = floatEphone.chats.find((chat) => chat.isGroup);
assert.equal(floatGroup.name, 'Float 群');
assert.equal(floatGroup.history[0].senderName, '游游');
assert.ok(floatEphone.chats.some((chat) => chat.name === '没聊过'), '未开会话的角色卡不能丢');
assert.ok(floatEphone.chats.some((chat) => chat.name === '游游' && !chat.isGroup),
  '只在群里出现的角色也要有独立联系人，否则导入后群成员没有角色卡');
assert.equal(floatEphone.globalSettings[0].name, '主人');
assert.equal(floatEphone.worldBooks.length, 1);
// 展开一层：split() 产出的数组来自 vm realm，deepStrictEqual 会比原型
assert.deepEqual([...floatEphone.worldBooks[0].content[0].keys], ['云', '城'], '逗号串关键词要拆开');
assert.equal(floatEphone.worldBooks[0].content[1].enabled, false, 'disable:true 要翻译成 enabled:false');

const floatStats = context.collectStats('float', floatData);
assert.equal(floatStats.characters, 3);
assert.equal(floatStats.groups, 1);
assert.equal(floatStats.messages, 4);

// ephone → Float，并把生成的 ZIP 再读回来验证结构闭环
const floatBlob = await context.toFloatBackup('ephone', ephone);
const floatEntries = await context.readZipEntries({
  name: 'float.zip',
  arrayBuffer: () => floatBlob.arrayBuffer(),
});
const floatMap = context.zipEntryMap(floatEntries);
const floatManifest = JSON.parse(new TextDecoder().decode(floatMap.get('manifest.json')));
assert.equal(floatManifest.format, 'ai-phone-backup');
assert.equal(context.isFloatManifest(floatManifest), true);

const chatModule = JSON.parse(new TextDecoder().decode(floatMap.get('modules/chat/000.json')));
assert.equal(chatModule.moduleId, 'chat');
assert.equal(chatModule.sources[0].dbName, 'AiPhoneChatDB');
const storeByName = Object.fromEntries(chatModule.sources[0].stores.map((store) => [store.name, store]));
assert.equal(storeByName.sessions.records.length, 2);
assert.equal(storeByName.contacts.records.length, 1, '群聊不产生 contact');
assert.equal(storeByName.messages.records.length, 3);
assert.equal(storeByName.messages.records[0].value.role, 'user');
assert.equal(storeByName.messages.keyPath, 'id');

const charModule = JSON.parse(new TextDecoder().decode(floatMap.get('modules/characters/000.json')));
const charKv = charModule.sources[0].records.find((record) => record.key === 'ai_phone_characters_v1');
assert.equal(JSON.parse(charKv.value).length, 1);

// 世界书与身份/API 键必须落在 settings 模块（Float 的模块登记表就是这么分的）
const settingsModule = JSON.parse(new TextDecoder().decode(floatMap.get('modules/settings/000.json')));
const settingsIdb = settingsModule.sources.find((source) => source.type === 'indexeddb');
assert.equal(settingsIdb.dbName, 'AiPhoneSettingsDB');
const floatBook = settingsIdb.stores[0].records[0].value;
assert.equal(floatBook.name, '设定');
assert.equal(floatBook.entries[0].key, '城', '关键词要合成逗号串');
assert.equal(floatBook.entries[0].disable, false);
assert.equal(floatBook.entries[0].position, 'before_char');
const settingsKv = settingsModule.sources.find((source) => source.type === 'kv');
assert.ok(settingsKv.records.some((record) => record.key === 'ai_phone_user_identities_v1'));

// 世界书往返：Float → ephone → Float
const floatLoreRoundTrip = context.toEphoneCompatible('float', floatData).data.worldBooks;
const floatLoreBack = await context.toFloatBackup('ephone', {
  version: 3, timestamp: 1, data: { chats: [], worldBooks: floatLoreRoundTrip },
});
const floatLoreMap = context.zipEntryMap(await context.readZipEntries({
  name: 'lore.zip', arrayBuffer: () => floatLoreBack.arrayBuffer(),
}));
const loreSettings = JSON.parse(new TextDecoder().decode(floatLoreMap.get('modules/settings/000.json')));
const loreBook = loreSettings.sources.find((s) => s.type === 'indexeddb').stores[0].records[0].value;
assert.equal(loreBook.name, '漂浮之城');
assert.equal(loreBook.entries[0].key, '云,城');
assert.equal(loreBook.entries[1].disable, true, '禁用条目往返后仍是禁用');

// 把刚生成的 ZIP 当成源文件重新装配，确认 Float→Float 链路自洽
const reassembled = context.assembleFloatBackup(floatMap, floatManifest);
assert.equal(reassembled.characters.length, 1);
assert.equal(reassembled.sessions.length, 2);
assert.equal(reassembled.messages.length, 3);
const reassembledEphone = context.toEphoneCompatible('float', reassembled).data;
assert.equal(reassembledEphone.chats.length, 2);

// Float → 弯弯 / 章鱼机
const floatToWanwan = context.toWanwanBackup('float', floatData);
assert.equal(floatToWanwan.appName, '弯弯');
assert.equal(floatToWanwan.messages.length, 2);
assert.equal(floatToWanwan.groupChats.length, 1);
const floatOctopus = context.toOctopusBackup('float', floatData);
assert.equal(floatOctopus.groups.length, 1);

// 弯弯 → Float
const wanwanToFloatBlob = await context.toFloatBackup('wanwan', wanwan);
assert.ok(wanwanToFloatBlob.size > 0);
const wanwanFloatMap = context.zipEntryMap(await context.readZipEntries({
  name: 'w.zip',
  arrayBuffer: () => wanwanToFloatBlob.arrayBuffer(),
}));
const wanwanFloatChat = JSON.parse(new TextDecoder().decode(wanwanFloatMap.get('modules/chat/000.json')));
const wanwanFloatStores = Object.fromEntries(
  wanwanFloatChat.sources[0].stores.map((store) => [store.name, store]));
assert.equal(wanwanFloatStores.messages.records.length, 5);
assert.equal(wanwanFloatStores.sessions.records.length, 2);

// 糯叽机 → 弯弯 / Float（用户明确要求这条链路可用）
assert.equal(context.targetSupportsNuojiji('wanwan'), true);
assert.equal(context.targetSupportsNuojiji('float'), true);
const nuojijiToWanwan = context.toWanwanBackup('nuojiji', nuojiji);
assert.equal(nuojijiToWanwan.characters.length, 3, '用户 + 2 个角色');
assert.ok((await context.toFloatBackup('nuojiji', nuojiji)).size > 0);

// ===== 全格式互转矩阵 =====
// 用户要的是「弯弯 / Float 与 330、章鱼机、糯叽机、zz、糯米机双向互通」，
// 这里把每条方向都真跑一遍，任何一条抛异常或丢掉全部聊天都会在这里暴露。

const octopusSource = context.toOctopusBackup('ephone', ephone);
const zzSource = context.toZzBackup('ephone', ephone);
const nuojijiSource = context.toNuojijiBackup('ephone', ephone);
const handSource = context.toSullyBackup('sully-hand', 'ephone', ephone);
const csySource = context.toSullyBackup('sully-csy', 'ephone', ephone);

const sources = {
  ephone,
  octopus: octopusSource,
  zz: zzSource,
  nuojiji: nuojijiSource,
  'sully-hand': handSource,
  'sully-csy': csySource,
  wanwan,
  float: floatData,
};

// 每种源格式转成弯弯与 Float
for (const [format, data] of Object.entries(sources)) {
  const asWanwan = context.toWanwanBackup(format, data);
  assert.equal(asWanwan.appName, '弯弯', `${format} → 弯弯 输出不合法`);
  assert.equal(asWanwan.version, 1, `${format} → 弯弯 版本号不对`);
  assert.ok(asWanwan.characters.length > 0, `${format} → 弯弯 一个角色都没有`);
  assert.ok(asWanwan.chats.length + asWanwan.groupChats.length > 0, `${format} → 弯弯 一个会话都没有`);

  const zipBlob = await context.toFloatBackup(format, data);
  const map = context.zipEntryMap(await context.readZipEntries({
    name: `${format}.zip`, arrayBuffer: () => zipBlob.arrayBuffer(),
  }));
  const mf = JSON.parse(new TextDecoder().decode(map.get('manifest.json')));
  assert.ok(context.isFloatManifest(mf), `${format} → Float 清单不合法`);
  const stores = JSON.parse(new TextDecoder().decode(map.get('modules/chat/000.json')))
    .sources[0].stores;
  const sessionCount = stores.find((store) => store.name === 'sessions').records.length;
  assert.ok(sessionCount > 0, `${format} → Float 一个会话都没有`);
}

// 弯弯与 Float 转成其余每种格式
for (const [format, data] of [['wanwan', wanwan], ['float', floatData]]) {
  const asOctopus = context.toOctopusBackup(format, data);
  assert.ok(asOctopus.characters.length + asOctopus.groups.length > 0, `${format} → 章鱼机 为空`);

  const asZz = context.toZzBackup(format, data);
  assert.ok(asZz.contacts.length > 0, `${format} → zz 为空`);
  assert.ok(Object.keys(asZz.chatHistory).length > 0, `${format} → zz 没有聊天记录`);

  const asNuojiji = context.toNuojijiBackup(format, data);
  assert.equal(asNuojiji.version, 5, `${format} → 糯叽机 版本号不对`);
  const nuojijiDb = asNuojiji.data.structuredDB;
  assert.ok(nuojijiDb.characters.length > 0, `${format} → 糯叽机 一个角色都没有`);
  assert.ok(nuojijiDb.messages.length > 0, `${format} → 糯叽机 没有消息`);

  for (const flavor of ['sully-hand', 'sully-csy']) {
    const asSully = context.toSullyBackup(flavor, format, data);
    assert.ok(asSully.characters.length + asSully.groups.length > 0, `${format} → ${flavor} 为空`);
    assert.ok(asSully.messages.length > 0, `${format} → ${flavor} 没有消息`);
  }

  const asEphone = context.toEphoneCompatible(format, data);
  assert.equal(asEphone.version, 3, `${format} → 330 版本号不对`);
  assert.ok(asEphone.data.chats.length > 0, `${format} → 330 为空`);
}

console.log('converter tests passed');
