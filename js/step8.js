// step8.js (STEP8: タイマー)。音声通信 (comm.js) を使う。
//   「動作停止[T]秒」「動作停止[T]秒 or 音センサ」ブロックは、プログラム転送時に
//     [160, T, アドレス] / [161, T, アドレス] の3バイトとして送られる。
//   マイコン側でその命令が成立すると、確認コードとして [160, 1] / [161, 1] が送られてくるので、
//     シミュレーション実行(プログラム実行ボタン)ではそれを待って次に進む。
let appState = 0;
let isSimulating = false;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const comm = window.parent.comm;

const ledImage = document.getElementById('led-image');
const deviceStatusText = document.getElementById('device-status');

// ===== FSK受信の監視 (comm-byte イベントの並びを見て、160/161 の2バイト組を検出する) =====
let fskBuffer = [];
window.addEventListener('comm-byte', (e) => {
    const value = e.detail.value;
    fskBuffer.push(value);
    if (fskBuffer.length > 2) fskBuffer.shift();
    if (fskBuffer.length === 2 && [160, 161].includes(fskBuffer[0])) {
        const data = [...fskBuffer];
        fskBuffer = [];
        window.dispatchEvent(new CustomEvent('sensor-detected', { detail: { data } }));
    }
});

// 「動作停止[T]秒」「動作停止[T]秒 or 音センサ」の確認コードを待つ (160,1 または 161,1)
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
    Blockly.serialization.workspaces.load(defaultBlocksJsonStep8Timer, window.workspace);
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
            } else if (block.type === 'cmd_wait_timer' || block.type === 'cmd_wait_timer_or_sound') {
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
            } else if (block.type === 'cmd_wait_timer') {
                const t = Number(block.getFieldValue('T'));
                bytes.push(160, t, nextAddr);
            } else if (block.type === 'cmd_wait_timer_or_sound') {
                const t = Number(block.getFieldValue('T'));
                bytes.push(161, t, nextAddr);
            }
            block = nextBlock;
        }
        return bytes;
    }

    let endAddr = assignAddresses(startBlock.getNextBlock(), 2);
    let payloadBytes = generateBytes(startBlock.getNextBlock(), endAddr);

    if (payloadBytes.length > 0) {
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
                else if (block.type === 'cmd_wait_timer') {
                    await waitForSensor(160, 1);
                }
                else if (block.type === 'cmd_wait_timer_or_sound') {
                    await waitForSensor(161, 1);
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

// 親画面(index.html)のSTEP9タブへ移動する
window.goToStep9 = function() {
    if (window.parent && window.parent.document) {
        const step9Tab = window.parent.document.getElementById('tab-step9');
        if (step9Tab) step9Tab.click();
    }
};