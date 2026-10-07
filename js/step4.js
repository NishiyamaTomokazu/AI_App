// step4.js (STEP4): Blocklyでプログラムを組む。音声通信 (comm.js) を使う。
let appState = 0;
let isSimulating = false;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const comm = window.parent.comm;

const ledImage = document.getElementById('led-image');
const deviceStatusText = document.getElementById('device-status');

window.addEventListener('load', () => {
    window.workspace = Blockly.inject('blocklyDiv', {
        toolbox: document.getElementById('toolbox'),
        move: { scrollbars: true, drag: true, wheel: true }
    });
    Blockly.serialization.workspaces.load(defaultBlocksJsonStep4, window.workspace);
    const blocklyDiv = document.getElementById('blocklyDiv');
    const resizeObserver = new ResizeObserver(() => {
        if (window.workspace) { Blockly.svgResize(window.workspace); }
    });
    resizeObserver.observe(blocklyDiv);
    disableManualButtons();
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
    disableManualButtons();
});

// 手動パネルは押せないようにする (Blocklyのプログラム実行に合わせて色だけ変わる)
function disableManualButtons() {
    ['red-on', 'red-off', 'green-on', 'green-off', 'blue-on', 'blue-off', 'end-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { btn.style.pointerEvents = 'none'; btn.style.cursor = 'default'; }
    });
}

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

// Blocklyの実行(シミュレーション)に合わせて、LEDの表示色だけを更新する
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
// data[0]=230 で始まる配列を comm.send() に渡すと、
// [253, 1, 転送ブロック番号] のヘッダーを付けて16バイトずつ自動で分割送信される。
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
            }
            currentBlock = currentBlock.getNextBlock();
        }
    } catch (err) {
        // 途中で何か失敗しても、isSimulatingを確実に解除する (これが無いと次回押しても反応しなくなる)
        console.error('プログラム実行中にエラー:', err);
    } finally {
        isSimulating = false;
        resetSimulator();
    }
});