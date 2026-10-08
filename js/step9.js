// step9.js (STEP9): 自由課題。これまでの全ブロックを組み合わせる。音声通信 (comm.js) を使う。
//   初期配置ブロックは「プログラムスタート」の下にLEDブロックを1つだけ繋げた、シンプルな形。
//   マイコンから FSK で [180または181, 結果(0/1)] が届くと、条件分岐の判定として扱う。
//     180 = 「もし SW=ON なら」の判定結果 / 181 = 「もし SW=OFF なら」の判定結果
//   専用のマイクは起動せず、comm が接続時から受信し続けているバイト列をそのまま利用する。
let appState = 0;
let isSimulating = false;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const comm = window.parent.comm;

const ledImage = document.getElementById('led-image');
const deviceStatusText = document.getElementById('device-status');
const brightnessText = document.getElementById('brightness-val');

// ===== FSK受信の監視 (comm-byte イベントの並びを見て、170/171/180/181/244 の2バイト組を検出する) =====
//   244 は「明るさ」専用のコード。[244, 明るさ(0〜100)] が不定期に届くたびに表示を更新する。
let fskBuffer = [];
window.addEventListener('comm-byte', (e) => {
    const value = e.detail.value;
    fskBuffer.push(value);
    if (fskBuffer.length > 2) fskBuffer.shift();
    if (fskBuffer.length === 2 && [170, 171, 180, 181, 244].includes(fskBuffer[0])) {
        const data = [...fskBuffer];
        fskBuffer = [];
        if (data[0] === 244) {
            brightnessText.textContent = data[1];
        } else {
            window.dispatchEvent(new CustomEvent('sensor-detected', { detail: { data } }));
        }
    }
});

// 条件分岐の判定結果を待つ。targetCode (180=SW=ON判定 / 181=SW=OFF判定) に一致したら、結果(0/1)を返す
function waitForCondition(targetCode) {
    return new Promise((resolve) => {
        const listener = (event) => {
            const data = event.detail.data;
            if (data.length >= 2 && data[0] === targetCode) {
                window.removeEventListener('sensor-detected', listener);
                resolve(data[1]);
            }
        };
        window.addEventListener('sensor-detected', listener);
    });
}

// 「音が鳴るまで待つ」「スイッチが押されるまで待つ」(STEP7のツールボックスには無いが、互換のため残す)
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
    Blockly.serialization.workspaces.load(defaultBlocksJsonStep9, window.workspace);
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
// cmd_if / cmd_if_else は入れ子になるため、まず各ブロックの送信先アドレスを計算してから (assignAddresses)、
// 実際のバイト列を組み立てる (generateBytes)、2段階の処理になっている。元のロジックをそのまま移植。
document.getElementById('transfer-btn').addEventListener('click', async () => {
    if (isSimulating || !window.workspace) return;
    const startBlock = window.workspace.getBlocksByType('cmd_start')[0];
    if (!startBlock) return alert("「プログラムスタート」ブロックが見つかりません！");

    let blockData = new Map();
    function assignAddresses(block, currentAddr) {
        while (block) {
            let info = { addr: currentAddr, size: 0 };
            blockData.set(block.id, info);
            if (block.type === 'cmd_if' || block.type === 'cmd_if_else') {
                info.size = 3;
                currentAddr += 3;
                let doBlock = block.getInputTargetBlock('DO');
                let elseBlock = block.getInputTargetBlock('ELSE');
                info.trueStart = currentAddr;
                if (doBlock) currentAddr = assignAddresses(doBlock, currentAddr);
                info.falseStart = currentAddr;
                if (elseBlock) currentAddr = assignAddresses(elseBlock, currentAddr);
                if (!doBlock) info.trueStart = currentAddr;
                if (!elseBlock) info.falseStart = currentAddr;
            } else if (block.type === 'cmd_loop') {
                info.size = 3;
                currentAddr += 3;
                let doBlock = block.getInputTargetBlock('DO');
                info.bodyStart = currentAddr;
                if (doBlock) currentAddr = assignAddresses(doBlock, currentAddr);
                info.loopEndAddr = currentAddr;
                currentAddr += 2;
            } else if (block.type === 'cmd_led') {
                info.size = 6; currentAddr += 6;
            } else if (block.type === 'cmd_wait_sound' || block.type === 'cmd_wait_switch') {
                info.size = 2; currentAddr += 2;
            }
            block = block.getNextBlock();
        }
        return currentAddr;
    }

    function generateBytes(block, exitAddr) {
        let bytes = [];
        while (block) {
            let info = blockData.get(block.id);
            let nextBlock = block.getNextBlock();
            let nextAddr = nextBlock ? blockData.get(nextBlock.id).addr : exitAddr;
            if (block.type === 'cmd_if' || block.type === 'cmd_if_else') {
                let isOff = block.getInputTargetBlock('COND')?.type === 'cond_switch_off';
                bytes.push(isOff ? 181 : 180, info.trueStart, info.falseStart);
                let doBlock = block.getInputTargetBlock('DO');
                if (doBlock) bytes.push(...generateBytes(doBlock, nextAddr));
                let elseBlock = block.getInputTargetBlock('ELSE');
                if (elseBlock) bytes.push(...generateBytes(elseBlock, nextAddr));
            } else if (block.type === 'cmd_loop') {
                let count = Number(block.getFieldValue('COUNT'));
                bytes.push(190, count, info.bodyStart);
                let doBlock = block.getInputTargetBlock('DO');
                if (doBlock) bytes.push(...generateBytes(doBlock, info.loopEndAddr));
                bytes.push(191, nextAddr);
            } else if (block.type === 'cmd_led') {
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
            } else if (block.type === 'cmd_wait_sound') {
                bytes.push(170, nextAddr);
            } else if (block.type === 'cmd_wait_switch') {
                bytes.push(171, nextAddr);
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
                else if (block.type === 'cmd_wait_sound') {
                    await waitForSensor(170, 1);
                }
                else if (block.type === 'cmd_wait_switch') {
                    await waitForSensor(171, 1);
                }
                else if (block.type === 'cmd_if' || block.type === 'cmd_if_else') {
                    let condBlock = block.getInputTargetBlock('COND');
                    let condType = condBlock ? condBlock.type : 'cond_switch_on';
                    let targetCode = (condType === 'cond_switch_off') ? 181 : 180;
                    let result = await waitForCondition(targetCode);
                    if (result === 1) {
                        let doBlock = block.getInputTargetBlock('DO');
                        if (doBlock) await executeBlock(doBlock);
                    } else {
                        let elseBlock = block.getInputTargetBlock('ELSE');
                        if (elseBlock) await executeBlock(elseBlock);
                    }
                }
                else if (block.type === 'cmd_loop') {
                    let count = Number(block.getFieldValue('COUNT'));
                    let doBlock = block.getInputTargetBlock('DO');
                    for (let i = 0; i < count; i++) {
                        if (!isSimulating) break;
                        window.workspace.highlightBlock(block.id);
                        if (doBlock) await executeBlock(doBlock);
                    }
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
