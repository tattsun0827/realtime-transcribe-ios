// 設定画面（APIキー・マイク入力元）と波形描画の純粋関数群。
// DOMもマイクも触らないので、ブラウザとNode（テスト）の両方から同じロジックをimportできる。

// 波形に残す履歴の本数。監視ループは100ms間隔なので、96本で直近およそ10秒分になる
export const WAVE_SAMPLES = 96;

// Groq APIキーの形式チェック。gsk_ から始まる十分な長さの文字列だけを受け付ける。
// 実在するキーかはここでは分からない（無効キーは送信時の401で検出して録音ごと止める）
export function isValidApiKeyFormat(key) {
  const value = (key || '').trim();
  return value.startsWith('gsk_') && value.length >= 12;
}

// 保存済みキーを画面に出すための伏せ字。全体は出さず、本人が「どのキーか」を見分けられる末尾4桁だけ残す
export function maskApiKey(key) {
  const value = (key || '').trim();
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

// マイク一覧から選択肢に出す分だけを取り出す。
// ブラウザは同じ物理マイクを default / communications という別名でも返すため、
// 「既定のマイク」と重複しないよう除外する（ACS の loadMicDevices と同じ方針）
export function selectableMicDevices(devices) {
  return (devices || []).filter(
    (d) => d && d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications'
  );
}

// 選択肢の表示名。マイクの使用を許可するまで label は空文字で返ってくるので、その時は連番で示す
export function micOptionLabel(device, index) {
  const label = (device && device.label) || '';
  return label.trim() || `マイク ${index + 1}`;
}

// 保存済みのdeviceIdが今も接続されているかを確かめる。
// 外したUSBマイクのIDを exact 指定すると getUserMedia が OverconstrainedError で失敗するため、
// 見つからなければ空文字（＝既定のマイク）へ落とす
export function resolveMicDeviceId(savedId, devices) {
  if (!savedId) return '';
  return selectableMicDevices(devices).some((d) => d.deviceId === savedId) ? savedId : '';
}

// getUserMedia へ渡す audio 制約。ノイズ抑制などは認識精度に直結するので常に有効化する。
// deviceId が空なら指定そのものを付けない（既定のマイクに任せる）
export function audioConstraints(deviceId) {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio };
}

// 波形1本の高さ。声のRMSは0.02〜0.2程度に集まるので8倍して見える高さにする。
// 無音でも最小の1本を残し、「描画が止まっている」のか「音が無い」のかを区別できるようにする
export function waveBarHeight(rms, canvasHeight, minPx) {
  const min = minPx > 0 ? minPx : 1;
  const usable = Math.max(0, canvasHeight - 2 * min);
  return Math.max(min, Math.min(1, Math.max(0, rms) * 8) * usable);
}
