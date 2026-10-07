// comm.js
// マイコンとの音声通信モジュール (HIDは使いません)
//
//   送信: Webアプリ → マイコン  19バイト固定のパケットを音声で送る
//     - データの先頭が 230 のとき (ブロックプログラムのデータ):
//         16バイトずつに分割し、各パケットの先頭に
//         [253, 1, ブロック番号] のヘッダーを付けて19バイトにする。
//         (先頭の230自身も、最初のブロックの16バイトに含まれる)
//     - それ以外 (接続確認・実行コマンド・LED手動操作など):
//         ヘッダーは付けず、渡されたバイト列をそのまま先頭に置き、
//         残りを0で埋めて19バイトにする。
//
//   受信: マイコン → Webアプリ  FSK (fsk-receiver.js / fsk-processor.js)
//
// 使い方 (各ページから):
//   const comm = window.parent.comm;
//   await comm.connect();                        // クリック操作の中で呼ぶ (iPadの制約)
//   await comm.send([253, 5]);                    // 接続確認など。そのまま19バイトに0埋め
//   await comm.send([253, 2]);                    // 実行コマンド
//   await comm.send([248, 240, appState]);        // LED手動操作
//   await comm.send([230, ...programBytes]);      // ブロックプログラムのデータ。自動で分割される
//   // 受信は親ページから 'comm-byte' イベントとして届く (detail.value に1バイト)

import { FskReceiver } from './fsk-receiver.js';

export const CONFIG = {
  // マイコン → Webアプリ (FSK受信)
  rx: { baud: 200, freq0: 1200, freq1: 2200, threshold: 0.01 },
  // Webアプリ → マイコン (音声送信)
  tx: {
    blockGapSamples: 1024, // 1パケット送り終えた直後の無音 (サンプル数。元のAI_Clockと同じ)
    blockWaitMs: 500,      // さらに続けて置く無音時間 (ms)。複数パケットの間隔
    leadMs: 50,            // 再生開始直後の音切れ対策の無音 (ms)
  },
};

// ---- プロトコル定数 ----
const PACKET_LEN = 19;          // 1パケットは常に19バイト
const CHUNK_LEN = 16;           // ブロックプログラムデータの分割単位
const HEADER_FIXED = 253;       // ヘッダー1バイト目 (iPadモード固定値)
const HEADER_TYPE_TRANSFER = 1; // ヘッダー2バイト目: データ転送開始
const BLOCK_DATA_MARK = 230;    // この値で始まるデータだけ、ヘッダー付き分割の対象にする

// ---- 1バイトぶんの波形 (元のAI_Clockと同じ形式。サンプル数で指定) ----
//   同期: 0を20個 → 1を30個
//   各ビット (MSBファースト): 0を5個 → 1を5個 (ビット0) / 1を15個 (ビット1)
//   終端: 0を20個
// 1パケット(19バイト)の中では、バイトごとの間隔はなく連続して並ぶ。
const SYNC_LOW = 20, SYNC_HIGH = 30;
const BIT_LOW = 5, BIT0_HIGH = 5, BIT1_HIGH = 15;
const END_LOW = 20;

const bitsOf = (b) => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1);

function byteLength(b) {
  let n = SYNC_LOW + SYNC_HIGH + END_LOW;
  for (const bit of bitsOf(b)) n += BIT_LOW + (bit ? BIT1_HIGH : BIT0_HIGH);
  return n;
}

function packetLength(packet) {
  let n = 0;
  for (const b of packet) n += byteLength(b);
  return n;
}

/**
 * 渡されたデータを、送信用の19バイトパケットの配列に組み立てる。
 *   - data[0] === 230 のとき: 16バイトずつに分割し、[253, 1, ブロック番号] を付けて19バイトにする
 *   - それ以外のとき: そのまま19バイトに0埋め (ヘッダーなし、1パケットのみ)
 * @param {number[]} data
 * @returns {number[][]} 19バイトのパケットの配列
 */
export function buildPackets(data) {
  data = Array.from(data);
  if (!data.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new Error('送信データは 0〜255 の整数にしてください');
  }

  if (data.length > 0 && data[0] === BLOCK_DATA_MARK) {
    const packets = [];
    let blockNum = 1;
    for (let i = 0; i < data.length; i += CHUNK_LEN) {
      const chunk = data.slice(i, i + CHUNK_LEN);
      const packet = new Array(PACKET_LEN).fill(0);
      packet[0] = HEADER_FIXED;
      packet[1] = HEADER_TYPE_TRANSFER;
      packet[2] = blockNum;
      for (let j = 0; j < chunk.length; j++) packet[3 + j] = chunk[j];
      packets.push(packet);
      blockNum++;
    }
    return packets;
  }

  // それ以外 (接続確認・実行コマンド・LED手動操作など): ヘッダーなしでそのまま0埋め
  if (data.length > PACKET_LEN) {
    throw new Error(`データが ${PACKET_LEN} バイトを超えています (${data.length}バイト)`);
  }
  const packet = new Array(PACKET_LEN).fill(0);
  for (let i = 0; i < data.length; i++) packet[i] = data[i];
  return [packet];
}

/**
 * 19バイトパケットの配列を、1本の音声波形(サンプル列)に変換する。
 * パケットとパケットの間には、無音 (blockGapSamples + blockWaitMs) を入れる。
 * @returns {{samples: Float32Array, packetStarts: number[]}} packetStarts は各パケットの開始サンプル位置
 */
export function encodePackets(packets, sampleRate, tx = CONFIG.tx) {
  const lead = Math.round(sampleRate * tx.leadMs / 1000);
  const waitSamples = Math.round(sampleRate * tx.blockWaitMs / 1000);
  const gapSamples = tx.blockGapSamples + waitSamples;

  const packetStarts = [];
  let total = lead;
  packets.forEach((packet) => {
    packetStarts.push(total);
    total += packetLength(packet) + gapSamples;
  });

  const samples = new Float32Array(total); // 0 で初期化済み (無音)
  packets.forEach((packet, k) => {
    let i = packetStarts[k];
    const high = (n) => { for (let j = 0; j < n; j++) samples[i++] = 1; };
    for (const b of packet) {
      i += SYNC_LOW; high(SYNC_HIGH);
      for (const bit of bitsOf(b)) {
        i += BIT_LOW;
        high(bit ? BIT1_HIGH : BIT0_HIGH);
      }
      i += END_LOW; // 終端の0はFloat32Arrayの初期値のまま
    }
  });
  return { samples, packetStarts };
}

// ---- 通信オブジェクト ----
class Comm extends EventTarget {
  constructor() {
    super();
    this.connected = false;
    this.productName = '音声通信 (iPad)';
    this.rx = null;
    this.lastError = null;
    this._connecting = null;
    this._txChain = Promise.resolve();
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** マイク(受信)とスピーカー(送信)を準備する。クリック操作の中で呼ぶこと。 */
  connect() {
    if (this.connected) return Promise.resolve(true);
    if (this._connecting) return this._connecting;

    // async関数は最初の await まで同期実行される。rx.start() の AudioContext 作成と
    // マイク要求が、クリック操作の同期部分で始まるようにしている (iPad Safari の制約)
    this._connecting = (async () => {
      const rx = new FskReceiver({
        ...CONFIG.rx,
        onByte: (value) => this._emit('byte', { value }),
        onFrameError: (count) => this._emit('frameError', { count }),
      });
      try {
        await rx.start();
      } catch (err) {
        console.error('音声通信の準備に失敗:', err);
        this.lastError = err;
        return false;
      } finally {
        this._connecting = null;
      }
      this.rx = rx;
      this.connected = true;
      this.lastError = null;
      console.log('🎤🔊 音声通信の準備ができました (受信 %dbps)', CONFIG.rx.baud);
      this._emit('status', { connected: true });
      return true;
    })();
    return this._connecting;
  }

  async disconnect() {
    const rx = this.rx;
    this.rx = null;
    this.connected = false;
    if (rx) { try { await rx.stop(); } catch (e) { console.error(e); } }
    this._emit('status', { connected: false });
  }

  /**
   * バイト列を音声で送る。
   *   - 先頭が230のデータは、16バイトずつに分割してヘッダー付きで送る
   *   - それ以外は、そのまま19バイトに0埋めして1パケットで送る
   * 送信が終わると解決する。連続して呼んでも順番に送られる。
   * @param {number[]} data
   * @param {{onProgress?: (packetIndex:number, packetCount:number)=>void}} [opts]
   */
  send(data, opts = {}) {
    let packets;
    try {
      packets = buildPackets(data);
    } catch (err) {
      return Promise.reject(err);
    }
    if (!this.connected || !this.rx || !this.rx.audioCtx) {
      console.log('【音声送信】未接続です。送信をスキップします。');
      return Promise.resolve(false);
    }
    console.log('◆ 送信データ (元データ):', data, `→ ${packets.length}パケット`);
    packets.forEach((p, i) => console.log(`  パケット${i + 1}/${packets.length} (19バイト):`, p));
    const job = this._txChain.then(() => this._play(packets, opts));
    this._txChain = job.catch(() => {});
    return job;
  }

  // 旧名 (1バイトずつ送信していたときの互換用)。中身は send() と同じ。
  sendBytes(data, opts) { return this.send(data, opts); }

  async _play(packets, { onProgress } = {}) {
    const ctx = this.rx && this.rx.audioCtx;
    if (!ctx) return false;
    if (ctx.state === 'suspended') await ctx.resume();

    const { samples, packetStarts } = encodePackets(packets, ctx.sampleRate);
    const buffer = ctx.createBuffer(2, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples); // 元のAI_Clockと同じく左チャンネルに出力

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const timers = [];
    if (onProgress) {
      packetStarts.forEach((s, k) => {
        timers.push(setTimeout(() => onProgress(k, packets.length), 1000 * s / ctx.sampleRate));
      });
    }

    await new Promise((resolve) => {
      source.onended = resolve;
      source.start();
    });
    timers.forEach(clearTimeout);
    console.log('【音声送信】完了 (%dパケット)', packets.length);
    return true;
  }
}

export const comm = new Comm();
