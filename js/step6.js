// step6.js (STEP6): 「スイッチが押されるまで待つ」ブロック。音声通信 (comm.js) を使う。
//   マイコンからFSKで 171 → 1 の順に届いたら、「スイッチが押されるまで待つ」ブロックが次に進む。
//   専用のマイクは起動せず、comm が接続時から受信し続けているバイト列をそのまま利用する。
let appState = 0;
let isSimulating = false;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const comm = window.parent.comm;

const ledImage = document.getElementById('led-image');
const deviceStatusText = document.getElementById('device-status');

// ===== FSK受信の監視 (comm-byte イベントの並びを見て、171→1 を検出する) =====
let fskBuffer = [];
window.addEventListener('comm-byte', (e) => {
    const value = e.detail.value;
    fskBuffer.push(value);
    if (fskBuffer.length > 2) fskBuffer.shift();
    if (fskBuffer.length === 2 && fskBuffer[0] === 171 && fskBuffer[1] === 1) {
        fskBuffer = [];
        window.dispatchEvent(new CustomEvent('sensor-detected', { detail: { data: [171, 1] } }));
    }
});

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

// スタート以降のブロックの並びに、指定タイプのブロックがあるか
function chainHasType(startBlock, type) {
    let b = startBlock.getNextBlock();
    while (b) {
        if (b.type === type) return true;
        b = b.getNextBlock();
    }
    return false;
}

window.addEventListener('load', () => {
    window.workspace = Blockly.inject('blocklyDiv', {
        toolbox: document.getElementById('toolbox'),
        move: { scrollbars: true, drag: true, wheel: true }
    });
    Blockly.serialization.workspaces.load(defaultBlocksJsonStep6, window.workspace);
    const blocklyDiv = document.getElementById('blocklyDiv');
    const resizeObserver = new ResizeObserver(() => {
        if (window.workspace) { Blockly.svgResize(window.workspace); }
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
// cmd_led → [130, r, g, b, 秒数, addr]  /  cmd_wait_switch → [171, addr]
// data[0]=230 なので、comm.send() が自動で [253, 1, ブロック番号] のヘッダーを付けて分割送信する。
document.getElementById('transfer-btn').addEventListener('click', async () => {
    if (isSimulating || !window.workspace) return;
    const startBlock = window.workspace.getBlocksByType('cmd_start')[0];
    if (!startBlock) return alert("「プログラムスタート」ブロックが見つかりません！");

    let programBytes = [230, 2];
    let addr = 2;
    let hasHardwareCommand = false;
    let currentBlock = startBlock.getNextBlock();
    while (currentBlock) {
        if (currentBlock.type === 'cmd_led') {
            const colorName = currentBlock.getFieldValue('COLOR');
            const timeSec = Number(currentBlock.getFieldValue('TIME'));
            let r = 0, g = 0, b = 0;
            switch (colorName) {
                case "red": r = 255; break; case "green": g = 255; break; case "blue": b = 255; break;
                case "yellow": r = 255; g = 255; break; case "purple": r = 255; b = 255; break;
                case "cyan": g = 255; b = 255; break; case "white": r = 255; g = 255; b = 255; break;
            }
            let sec = Math.round(timeSec * 4);
            addr += 6;
            programBytes.push(130, r, g, b, sec, addr);
            hasHardwareCommand = true;
        } else if (currentBlock.type === 'cmd_wait_switch') {
            addr += 2;
            programBytes.push(171, addr);
            hasHardwareCommand = true;
        }
        currentBlock = currentBlock.getNextBlock();
    }

    if (hasHardwareCommand) {
        programBytes.push(231, 250);
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

    if (chainHasType(startBlock, 'cmd_wait_switch') && !comm.connected) {
        alert('「スイッチが押されるまで待つ」を使うには、先にAIクロックに接続してください。');
        return;
    }

    console.log("◆実行コマンド送信: [253, 2]");
    comm.send([253, 2]);

    isSimulating = true;
    try {
        window.workspace.highlightBlock(startBlock.id);

        let currentBlock = startBlock.getNextBlock();
        while (currentBlock) {
            window.workspace.highlightBlock(currentBlock.id);
            if (currentBlock.type === 'cmd_led') {
                const colorName = currentBlock.getFieldValue('COLOR');
                const timeSec = Number(currentBlock.getFieldValue('TIME'));
                appState = 0;
                switch (colorName) {
                    case "red": appState = 1; break; case "green": appState = 2; break; case "blue": appState = 4; break;
                    case "yellow": appState = 3; break; case "purple": appState = 5; break; case "cyan": appState = 6; break; case "white": appState = 7; break;
                }
                render();
                await wait(timeSec * 1000);
                appState = 0;
                render();
            } else if (currentBlock.type === 'cmd_wait_switch') {
                // マイコンから FSK で 171, 1 が届くまでここで待つ
                await waitForSensor(171, 1);
            }
            currentBlock = currentBlock.getNextBlock();
        }
    } catch (err) {
        console.error('プログラム実行中にエラー:', err);
    } finally {
        isSimulating = false;
        resetSimulator();
    }
});

// 親画面(index.html)のSTEP6タブへ移動する (STEP3の時点で既に表示されている)
window.goToStep7 = function() {
    if (window.parent && window.parent.document) {
        const step7Tab = window.parent.document.getElementById('tab-step7');
        if (step7Tab) step7Tab.click();
    }
};