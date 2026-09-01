#!/usr/bin/env node
// Groq Whisper API への疎通を確認するスモークテスト。
// GROQ_API_KEY が無ければ手順を表示してスキップする（exit 0）。

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3';

// 0.3秒分の無音PCM(16bit/16kHz/mono)を持つ最小WAVファイルを作る
function buildSilentWav(durationSec = 0.3, sampleRate = 16000) {
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2; // 16bit = 2byte/sample
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  // data部はBuffer.allocのゼロ埋めのまま＝無音

  return buf;
}

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.log('[SKIP] GROQ_API_KEY が未設定のためスキップします。');
    console.log('       実行するには: GROQ_API_KEY=gsk_... node test/smoke-groq.mjs');
    process.exit(0);
  }

  const wav = buildSilentWav();
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'silence.wav');
  form.append('model', GROQ_MODEL);
  form.append('language', 'ja');

  console.log('[dry-run] POST', GROQ_ENDPOINT, {
    model: GROQ_MODEL,
    fileSize: wav.length,
    authHeader: 'Bearer ***',
  });

  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[FAIL] Groq API が ${res.status} を返しました: ${text.slice(0, 300)}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log('[OK] Groq API 疎通成功。応答text:', JSON.stringify(data.text || ''));
  process.exit(0);
}

main().catch((err) => {
  console.error('[FAIL]', err.message);
  process.exit(1);
});
