// step7.js (STEP7: 光センサ)。音声通信 (comm.js) を使う。
//   マイコンから FSK で [244, 明るさ(0-100)] が不定期に届くと、明るさの表示を更新する。
//   「明るくなるまで待つ[N]」「暗くなるまで待つ[N]」ブロックは、プログラム転送時に
//     [177, N, アドレス] / [178, N, アドレス] の3バイトとして送られる。
//   マイコン側でその命令が成立すると、確認コードとして [177, 1] / [178, 1] が送られてくるので、
//     シミュレーション実行(プログラム実行ボタン)ではそれを待って次に進む。
let appState = 0;
let isSimulating = false;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const comm = window.parent.comm;

const ledImage = document.getElementById('led-image');
const deviceStatusText = document.getElementById('device-status');
const brightnessValEl = document.getElementById('brightness-val');

// ===== 明るさ(244, 値) の受信 =====
// マイコンから不定期に送られてくる。受信するたびに表示を更新する。
let brightnessValue = null;
window.addEventListener('brightness-received', (e) => {
    brightnessValue = e.detail.value;
    if (brightnessValEl) brightnessValEl.textContent = brightnessValue;
});

// 明るさデータを1つ受信するまで待つ（まだ受信していない場合のみ使う）
function waitForNextBrightness() {
    if (brightnessValue !== null) return Promise.resolve(brightnessValue);
    return new Promise((resolve) => {
        const listener = (event) => {
            window.removeEventListener('brightness-received', listener);
            resolve(event.detail.value);
        };
        window.addEventListener('brightness-received', listener);
    });
}

// ===== FSK受信の監視 (comm-byte イベントの並びを見て、177/178/244 の2バイト組を検出する) =====
let fskBuffer = [];
window.addEventListener('comm-byte', (e) => {
    const value = e.detail.value;
    fskBuffer.push(value);
    if (fskBuffer.length > 2) fskBuffer.shift();
    if (fskBuffer.length === 2 && [177, 178, 244].includes(fskBuffer[0])) {
        const data = [...fskBuffer];
        fskBuffer = [];
        if (data[0] === 244) {
            window.dispatchEvent(new CustomEvent('brightness-received', { detail: { value: data[1] } }));
        } else {
            window.dispatchEvent(new CustomEvent('sensor-detected', { detail: { data } }));
        }
    }
});

// 「明るくなるまで待つ」「暗くなるまで待つ」の確認コードを待つ (177,1 または 178,1)
function waitForSensor(targetCode, targetValue) {
    return new Promise((resolve) => {
        const listener = (event) => {
            const data = event.detail.data;
            if (data.length >= 2 && data[0] === targetCode && data[1] === targetValue) {
                window.removeEventListener('sensor-detected', listener);
                resolve();
            }
        };
        window.addEventListener('sensor-detected', listener);
    });
}

window.addEventListener('load', () => {
    window.workspace = Blockly.inject('blocklyDiv', {
        toolbox: document.getElementById('toolbox'),
        move: { scrollbars: true, drag: true, wheel: true }
    });
    Blockly.serialization.workspaces.load(defaultBlocksJsonStep7Light, window.workspace);
    const blocklyDiv = document.getElementById('blocklyDiv');
    const resizeObserver = new ResizeObserver(() => {
        if (window.workspace) Blockly.svgResize(window.workspace);
    });
    resizeObserver.observe(blocklyDiv);
});

window.addEventListener('DOMContentLoaded', () => {
    if (window.parent && window.parent.commHasClickedConnect) {
        const hint = document.getElementById('connect-hint');
        if (hint) hint.style.display = 'none';
    }
    if (comm && comm.connected) {
        deviceStatusText.textContent = `接続中 (${comm.productName})`;
        deviceStatusText.style.color = '#0ff';
    }
    resetSimulator();
});

async function connectDevice() {
    const success = await comm.connect();
    if (success) {
        deviceStatusText.textContent = `接続中 (${comm.productName})`;
        deviceStatusText.style.color = '#0ff';
        return true;
    }
    return false;
}

document.getElementById('connect-btn').addEventListener('click', async () => {
    const hint = document.getElementById('connect-hint');
    if (hint) hint.style.display = 'none';
    if (window.parent) window.parent.commHasClickedConnect = true;

    const success = await connectDevice();
    if (success) {
        console.log("◆AI クロック接続確認コマンド送信: [253, 5]");
        await comm.send([253, 5]);
    } else {
        alert('マイクを使えませんでした。\nマイクの使用を許可してから、もう一度お試しください。');
    }
});

function render() {
    if (appState === 8) {
        ledImage.style.backgroundColor = '#555'; ledImage.style.boxShadow = 'none';
        ['red-on','red-off','green-on','green-off','blue-on','blue-off'].forEach(id => document.getElementById(id).classList.remove('pressed'));
    } else {
        document.getElementById('red-on').classList.toggle('pressed', (appState & 1) !== 0);
        document.getElementById('green-on').classList.toggle('pressed', (appState & 2) !== 0);
        document.getElementById('blue-on').classList.toggle('pressed', (appState & 4) !== 0);
        document.getElementById('red-off').classList.toggle('pressed', (appState & 1) === 0);
        document.getElementById('green-off').classList.toggle('pressed', (appState & 2) === 0);
        document.getElementById('blue-off').classList.toggle('pressed', (appState & 4) === 0);
        if (appState === 0) {
            ledImage.style.backgroundColor = '#555'; ledImage.style.boxShadow = 'none';
        } else {
            const r = (appState & 1) ? 255 : 0, g = (appState & 2) ? 255 : 0, b = (appState & 4) ? 255 : 0;
            ledImage.style.backgroundColor = `rgb(${r}, ${g}, ${b})`; ledImage.style.boxShadow = `0 0 30px rgb(${r}, ${g}, ${b})`;
        }
    }
}

function resetSimulator() {
    appState = 8;
    render();
    if (window.workspace) window.workspace.highlightBlock(null);
}

// ---- プログラム転送 ----
document.getElementById('transfer-btn').addEventListener('click', async () => {
    if (isSimulating || !window.workspace) return;
    const startBlock = window.workspace.getBlocksByType('cmd_start')[0];
    if (!startBlock) return alert("「プログラムスタート」ブロックが見つかりません！");

    let blockData = new Map();
    function assignAddresses(block, currentAddr) {
        while (block) {
            let info = { addr: currentAddr, size: 0 };
            blockData.set(block.id, info);
            if (block.type === 'cmd_led') {
                info.size = 6; currentAddr += 6;
            } else if (block.type === 'cmd_wait_bright_up' || block.type === 'cmd_wait_bright_down') {
                info.size = 3; currentAddr += 3;
            }
            block = block.getNextBlock();
        }
        return currentAddr;
    }

    function generateBytes(block, exitAddr) {
        let bytes = [];
        while (block) {
            let nextBlock = block.getNextBlock();
            let nextAddr = nextBlock ? blockData.get(nextBlock.id).addr : exitAddr;
            if (block.type === 'cmd_led') {
                const colorName = block.getFieldValue('COLOR');
                const timeSec = Number(block.getFieldValue('TIME'));
                let r = 0, g = 0, bColor = 0;
                switch (colorName) {
                    case "red": r = 255; break; case "green": g = 255; break; case "blue": bColor = 255; break;
                    case "yellow": r = 255; g = 255; break; case "purple": r = 255; bColor = 255; break;
                    case "cyan": g = 255; bColor = 255; break; case "white": r = 255; g = 255; bColor = 255; break;
                }
                let sec = Math.round(timeSec * 4);
                bytes.push(130, r, g, bColor, sec, nextAddr);
            } else if (block.type === 'cmd_wait_bright_up') {
                const n = Number(block.getFieldValue('N'));
                bytes.push(177, n, nextAddr);
            } else if (block.type === 'cmd_wait_bright_down') {
                const n = Number(block.getFieldValue('N'));
                bytes.push(178, n, nextAddr);
            }
            block = nextBlock;
        }
        return bytes;
    }

    let endAddr = assignAddresses(startBlock.getNextBlock(), 2);
    let payloadBytes = generateBytes(startBlock.getNextBlock(), endAddr);

    if (payloadBytes.length > 0) {
        // 明るさデータを1つ受信するまで、転送の開始を待つ
        await waitForNextBrightness();
        let programBytes = [230, 2, ...payloadBytes, 231, 250];
        try {
            await comm.send(programBytes);
        } catch (err) {
            console.error('プログラム転送エラー:', err);
        }
    } else {
        alert("転送するブロックが繋がっていません！");
    }
});

// ---- プログラム実行 ----
document.getElementById('run-btn').addEventListener('click', async () => {
    if (isSimulating || !window.workspace) return;
    const startBlock = window.workspace.getBlocksByType('cmd_start')[0];
    if (!startBlock) return;

    // 明るさデータを1つ受信するまで、実行コマンドの送信を待つ
    await waitForNextBrightness();

    console.log("◆実行コマンド送信: [253, 2]");
    comm.send([253, 2]);

    isSimulating = true;
    try {
        async function executeBlock(block) {
            while (block && isSimulating) {
                window.workspace.highlightBlock(block.id);

                if (block.type === 'cmd_led') {
                    const colorName = block.getFieldValue('COLOR');
                    const timeSec = Number(block.getFieldValue('TIME'));
                    appState = 0;
                    switch (colorName) {
                        case "red": appState = 1; break; case "green": appState = 2; break; case "blue": appState = 4; break;
                        case "yellow": appState = 3; break; case "purple": appState = 5; break; case "cyan": appState = 6; break; case "white": appState = 7; break;
                    }
                    render();
                    await wait(timeSec * 1000);
                    appState = 0;
                    render();
                }
                else if (block.type === 'cmd_wait_bright_up') {
                    await waitForSensor(177, 1);
                }
                else if (block.type === 'cmd_wait_bright_down') {
                    await waitForSensor(178, 1);
                }
                block = block.getNextBlock();
            }
        }

        window.workspace.highlightBlock(startBlock.id);
        await executeBlock(startBlock.getNextBlock());
    } catch (err) {
        console.error('プログラム実行中にエラー:', err);
    } finally {
        isSimulating = false;
        resetSimulator();
    }
});

// 親画面(index.html)のSTEP8タブへ移動する (STEP3の時点で既に表示されている)
window.goToStep8 = function() {
    if (window.parent && window.parent.document) {
        const step8Tab = window.parent.document.getElementById('tab-step8');
        if (step8Tab) step8Tab.click();
    }
};
