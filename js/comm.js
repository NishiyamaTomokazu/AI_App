// comm.js
// マイコンとの音声通信モジュール (HIDは使いません)
//   送信: Webアプリ → マイコン  独自方式の音声波形で「1バイトずつ」送る
//   受信: マイコン → Webアプリ  FSK (fsk-receiver.js / fsk-processor.js)
//
// 使い方 (各ページから):
//   const comm = window.parent.comm;
//   await comm.connect();                    // クリック操作の中で呼ぶ (iPad の制約)
//   await comm.sendBytes([240, 230, 2]);     // 1バイトずつ送信。全部鳴り終わったら完了
//   // 受信は親ページから 'comm-byte' イベントとして届く (detail.value に1バイト)

import { FskReceiver } from './fsk-receiver.js';

export const CONFIG = {
  // マイコン → Webアプリ (FSK受信)
  rx: { baud: 200, freq0: 1200, freq1: 2200, threshold: 0.01 },
  // Webアプリ → マイコン (音声送信)
  //   byteGapMs : 1バイト送るごとの待ち時間。HID送信の wait(90) と同じ考え方
  //   leadMs    : 再生開始直後の音切れ対策の無音
  tx: { byteGapMs: 90, leadMs: 50 },
};

// ---- 1バイトぶんの波形 (元のAI_Clockと同じ形式。サンプル数で指定) ----
//   同期: 0を20個 → 1を30個
//   各ビット (MSBファースト): 0を5個 → 1を5個 (ビット0) / 1を15個 (ビット1)
//   終端: 0を20個
const SYNC_LOW = 20, SYNC_HIGH = 30;
const BIT_LOW = 5, BIT0_HIGH = 5, BIT1_HIGH = 15;
const END_LOW = 20;

const bitsOf = (b) => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1);

function byteLength(b) {
  let n = SYNC_LOW + SYNC_HIGH + END_LOW;
  for (const bit of bitsOf(b)) n += BIT_LOW + (bit ? BIT1_HIGH : BIT0_HIGH);
  return n;
}

/**
 * バイト列を、1バイトずつ間隔をあけた波形に変換する。
 * @returns {{samples: Float32Array, starts: number[]}} starts は各バイトの開始サンプル位置
 */
export function encodeBytes(bytes, sampleRate, tx = CONFIG.tx) {
  const gap = Math.round(sampleRate * tx.byteGapMs / 1000);
  const lead = Math.round(sampleRate * tx.leadMs / 1000);

  const starts = [];
  let total = lead;
  for (const b of bytes) {
    starts.push(total);
    total += byteLength(b) + gap;
  }

  const samples = new Float32Array(total);   // 0 で初期化済み (無音)
  bytes.forEach((b, k) => {
    let i = starts[k];
    const high = (n) => { for (let j = 0; j < n; j++) samples[i++] = 1; };
    i += SYNC_LOW; high(SYNC_HIGH);
    for (const bit of bitsOf(b)) {
      i += BIT_LOW;
      high(bit ? BIT1_HIGH : BIT0_HIGH);
    }
    // 終端の 0 は初期値のまま
  });
  return { samples, starts };
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
   * バイト列を1バイトずつ音声で送る (HID版 transferSharedHID と同じ使い方)。
   * 送信が終わると解決する。連続して呼んでも順番に送られる。
   * @param {number[]} bytes 0〜255 の整数の配列
   * @param {{onProgress?: (index:number, value:number, total:number)=>void}} [opts]
   */
  sendBytes(bytes, opts = {}) {
    bytes = Array.from(bytes);
    if (!bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
      return Promise.reject(new Error('送信データは 0〜255 の整数にしてください'));
    }
    if (!this.connected || !this.rx || !this.rx.audioCtx) {
      console.log('【音声送信】未接続です。送信をスキップします。');
      return Promise.resolve(false);
    }
    console.log('◆ 送信データ:', bytes);
    const job = this._txChain.then(() => this._play(bytes, opts));
    this._txChain = job.catch(() => {});
    return job;
  }

  async _play(bytes, { onProgress } = {}) {
    const ctx = this.rx && this.rx.audioCtx;
    if (!ctx) return false;
    if (ctx.state === 'suspended') await ctx.resume();

    const { samples, starts } = encodeBytes(bytes, ctx.sampleRate);
    const buffer = ctx.createBuffer(2, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);      // 元のAI_Clockと同じく左チャンネルに出力

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const timers = [];
    if (onProgress) {
      starts.forEach((s, k) => {
        timers.push(setTimeout(() => onProgress(k, bytes[k], bytes.length), 1000 * s / ctx.sampleRate));
      });
    }

    await new Promise((resolve) => {
      source.onended = resolve;
      source.start();
    });
    timers.forEach(clearTimeout);
    console.log('【音声送信】完了 (%dバイト)', bytes.length);
    return true;
  }
}

export const comm = new Comm();
