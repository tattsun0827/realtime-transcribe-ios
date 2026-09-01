// IndexedDBラッパー。会話(conversations)ストアの作成・逐次追記・一覧・取得を提供する。
// ID生成・タイトル生成は純粋関数として切り出し、Nodeテストからも直接importできるようにしている。

const DB_NAME = 'realtime-transcribe';
const DB_VERSION = 1;
const STORE_NAME = 'conversations';
const TITLE_MAX_CHARS = 20;

// 会話IDを生成する（時刻+乱数。この用途では衝突確率は実用上無視できる）
export function generateId(now = Date.now(), rand = Math.random()) {
  return `conv-${now}-${rand.toString(36).slice(2, 8)}`;
}

// 確定テキストの先頭からタイトル候補を作る（空ならnull＝呼び出し側でフォールバックする）
export function deriveTitle(text, maxChars = TITLE_MAX_CHARS) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) + '…' : trimmed;
}

// タイトルが一度も確定しなかった会話（無音のまま停止等）向けの日時フォールバック表記
export function formatFallbackTitle(epochMs) {
  const d = new Date(epochMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getRecord(store, id) {
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// 新しい会話レコードを作成して返す（録音開始時に呼ぶ）
export async function createConversation() {
  const db = await openDb();
  const now = Date.now();
  const conv = { id: generateId(now), title: '', createdAt: now, updatedAt: now, segments: [] };
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(conv);
  await txDone(tx);
  db.close();
  return conv;
}

// 会話に確定セグメントを1件追記する（録音終了を待たず、確定するたびに呼ぶ＝逐次保存）
export async function appendSegment(id, text) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const conv = await getRecord(store, id);
  if (conv) {
    conv.segments.push({ text, at: Date.now() });
    conv.updatedAt = Date.now();
    if (!conv.title) conv.title = deriveTitle(text);
    store.put(conv);
  }
  await txDone(tx);
  db.close();
}

// 表示用タイトルを決める。会話にタイトルが無い（1文も確定しないまま停止した）場合は
// 保存時ではなく表示直前にフォールバックを適用する。停止直後にまだ処理中のチャンクが
// 確定した場合でも、appendSegmentが空タイトルへ正しく書き込めるようにするための設計
export function displayTitle(conv) {
  return conv.title || formatFallbackTitle(conv.createdAt);
}

// 会話一覧を更新が新しい順で取得する
export async function listConversations() {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const rows = await new Promise((resolve, reject) => {
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

// 会話を1件取得する
export async function getConversation(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const conv = await getRecord(tx.objectStore(STORE_NAME), id);
  db.close();
  return conv;
}
