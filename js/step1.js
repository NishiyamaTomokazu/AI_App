// step1.js (PAGE1相当・STEP1): LEDシミュレータ。音声通信 (comm.js) を使う。
let appState = 0;

const comm = window.parent.comm;

const ledImage = document.getElementById('led-image');
const deviceStatusText = document.getElementById('device-status');

window.addEventListener('DOMContentLoaded', () => {
    // 他のタブで一度でも接続ボタンを押していれば、ヒントは表示しない
    if (window.parent && window.parent.commHasClickedConnect) {
        const hint = document.getElementById('connect-hint');
        if (hint) hint.style.display = 'none';
    }

    // 既に接続済みなら (他のタブで接続した場合など)、状態表示を更新して現在の色を送る
    if (comm && comm.connected) {
        deviceStatusText.textContent = `接続中 (${comm.productName})`;
        deviceStatusText.style.color = '#0ff';
        sendStateToDevice();
    }
});

document.getElementById('connect-btn').addEventListener('click', async () => {
    const hint = document.getElementById('connect-hint');
    if (hint) hint.style.display = 'none';
    if (window.parent) {
        window.parent.commHasClickedConnect = true;
    }

    const success = await comm.connect();
    if (success) {
        deviceStatusText.textContent = `接続中 (${comm.productName})`;
        deviceStatusText.style.color = '#0ff';

        console.log("◆AI クロック接続確認コマンド送信: [253, 5]");
        await comm.send([253, 5]);
        sendStateToDevice();
    } else {
        alert('マイクを使えませんでした。\nマイクの使用を許可してから、もう一度お試しください。');
    }
});

async function sendStateToDevice() {
    try {
        await comm.send([248, 240, appState]);
    } catch (error) {
        console.error("LED送信エラー:", error);
    }
}

function render() {
    if (appState === 8) {
        ledImage.style.backgroundColor = '#555';
        ledImage.style.boxShadow = 'none';
        document.getElementById('red-on').classList.remove('pressed');
        document.getElementById('green-on').classList.remove('pressed');
        document.getElementById('blue-on').classList.remove('pressed');
    } else {
        document.getElementById('red-on').classList.toggle('pressed', (appState & 1) !== 0);
        document.getElementById('green-on').classList.toggle('pressed', (appState & 2) !== 0);
        document.getElementById('blue-on').classList.toggle('pressed', (appState & 4) !== 0);
        if (appState === 0) {
            ledImage.style.backgroundColor = '#555';
            ledImage.style.boxShadow = 'none';
        } else {
            const r = (appState & 1) ? 255 : 0;
            const g = (appState & 2) ? 255 : 0;
            const b = (appState & 4) ? 255 : 0;
            ledImage.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
            ledImage.style.boxShadow = `0 0 30px rgb(${r}, ${g}, ${b})`;
        }
    }
    sendStateToDevice();
}

window.turnOn = function(value) {
    if (appState === 8) appState = 0;
    appState |= value;
    render();
};

window.turnOff = function(value) {
    if (appState === 8) appState = 0;
    appState &= ~value;
    render();
};

window.endApp = function() {
    appState = 8;
    render();
};

// 親画面(index.html)のタブを1つ進めて、STEP2を開く
window.goToStep2 = function() {
    if (window.parent && window.parent.document) {
        const tabs = window.parent.document.querySelectorAll('.tab-btn');
        if (tabs.length > 2) {
            tabs[2].click();
        }
    }
};

document.getElementById('red-on').addEventListener('click', () => turnOn(1));
document.getElementById('red-off').addEventListener('click', () => turnOff(1));
document.getElementById('green-on').addEventListener('click', () => turnOn(2));
document.getElementById('green-off').addEventListener('click', () => turnOff(2));
document.getElementById('blue-on').addEventListener('click', () => turnOn(4));
document.getElementById('blue-off').addEventListener('click', () => turnOff(4));
document.getElementById('end-btn').addEventListener('click', endApp);

render();
