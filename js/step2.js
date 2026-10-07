// step2.js (STEP2): 3秒チャレンジゲーム。音声通信 (comm.js) を使う。
let appState = 0;
let gameActive = false;
let currentQuestion = 0;
let targetColorValue = -1;
let timerId = null;
let consecutiveFailures = 0;

const comm = window.parent.comm;

const ledImage = document.getElementById('led-image');
const deviceStatusText = document.getElementById('device-status');
const gameMessageEl = document.getElementById('game-message');
const questionNumEl = document.getElementById('question-num');

const colorTasks = { 0:"消灯させて", 1:"赤を点灯させて", 2:"緑を点灯させて", 3:"黄色を点灯させて", 4:"青を点灯させて", 5:"紫を点灯させて", 6:"水色を点灯させて", 7:"白を点灯させて" };

window.addEventListener('DOMContentLoaded', () => {
    if (window.parent && window.parent.commHasClickedConnect) {
        const hint = document.getElementById('connect-hint');
        if (hint) hint.style.display = 'none';
    }

    if (comm && comm.connected) {
        deviceStatusText.textContent = `接続中 (${comm.productName})`;
        deviceStatusText.style.color = '#0ff';
        sendStateToDevice();
    }
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
    if (window.parent) {
        window.parent.commHasClickedConnect = true;
    }
    const success = await connectDevice();
    if (success) {
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

window.startGame = async function() {
    if (!comm.connected) {
        try { await connectDevice(); } catch (e) {}
    }

    appState = 8; render();
    gameActive = true;
    currentQuestion = 0;
    gameMessageEl.style.color = "#333";

    if (questionNumEl) questionNumEl.style.display = 'inline-block';

    const clearContainer = document.getElementById('clear-container');
    if (clearContainer) clearContainer.style.display = 'none';

    nextQuestion();
}

const startBtnEl = document.getElementById('start-game-btn');
if (startBtnEl) {
    startBtnEl.addEventListener('click', startGame);
}

function nextQuestion() {
    if (!questionNumEl) return;

    if (currentQuestion >= 5) {
        questionNumEl.textContent = "クリア！";
        gameMessageEl.textContent = "全問正解！";
        gameMessageEl.style.color = "#e65100";
        gameActive = false;

        const clearContainer = document.getElementById('clear-container');
        if (clearContainer) clearContainer.style.display = 'block';

        unlockStep3Tab();
        return;
    }

    currentQuestion++; questionNumEl.textContent = `第 ${currentQuestion} 問 / 全5問`;

    let nextTarget;
    do { nextTarget = Math.floor(Math.random() * 8); } while (nextTarget === appState);
    targetColorValue = nextTarget;
    gameMessageEl.textContent = `${colorTasks[targetColorValue]}ください`;
    gameMessageEl.style.color = "#333";

    clearTimeout(timerId);
    timerId = setTimeout(() => {
        if (gameActive) {
            gameActive = false;
            targetColorValue = -1;
            consecutiveFailures++;

            if (consecutiveFailures >= 3) {
                questionNumEl.textContent = "終了！";
                gameMessageEl.innerHTML = `難しかったかな？<br><span style="font-size: 22px; font-weight: bold; color: #764ba2;">STEP3に進みましょう</span>`;

                const clearContainer = document.getElementById('clear-container');
                if (clearContainer) clearContainer.style.display = 'block';

                unlockStep3Tab();
                consecutiveFailures = 0;
            } else {
                questionNumEl.textContent = "タイムアップ";
                gameMessageEl.innerHTML = `残念....<br><span style="font-size: 18px;">(正解数: ${currentQuestion - 1}問)</span>`;
                gameMessageEl.style.color = "red";
            }
        }
    }, 3000);
}

function checkGame() {
    if (!gameActive || targetColorValue === -1) return;
    if (appState === targetColorValue) {
        clearTimeout(timerId);
        targetColorValue = -1;
        consecutiveFailures = 0;
        gameMessageEl.textContent = "正解！";
        gameMessageEl.style.color = "green";
        setTimeout(() => { if (gameActive) nextQuestion(); }, 600);
    }
}

function render() {
    if (appState === 8) {
        ledImage.style.backgroundColor = '#555'; ledImage.style.boxShadow = 'none';
        document.getElementById('red-on').classList.remove('pressed'); document.getElementById('green-on').classList.remove('pressed'); document.getElementById('blue-on').classList.remove('pressed');
    } else {
        document.getElementById('red-on').classList.toggle('pressed', (appState & 1) !== 0);
        document.getElementById('green-on').classList.toggle('pressed', (appState & 2) !== 0);
        document.getElementById('blue-on').classList.toggle('pressed', (appState & 4) !== 0);
        if (appState === 0) { ledImage.style.backgroundColor = '#555'; ledImage.style.boxShadow = 'none'; } else {
            const r = (appState & 1) ? 255 : 0, g = (appState & 2) ? 255 : 0, b = (appState & 4) ? 255 : 0;
            ledImage.style.backgroundColor = `rgb(${r}, ${g}, ${b})`; ledImage.style.boxShadow = `0 0 30px rgb(${r}, ${g}, ${b})`;
        }
    }
    sendStateToDevice(); checkGame();
}

window.turnOn = function(value) { if (appState === 8) appState = 0; appState |= value; render(); }
window.turnOff = function(value) { if (appState === 8) appState = 0; appState &= ~value; render(); }
window.endApp = function() { appState = 8; render(); }

// 親画面(index.html)の、ID付きで隠してあるSTEP3タブを表示する
function unlockStep3Tab() {
    if (window.parent && window.parent.unlockTab) {
        window.parent.unlockTab('tab-step3');
    }
}

// 「STEP3へ進む」ボタン: リセットしてからSTEP3タブをクリックする
window.goToStep3 = function() {
    endApp();
    if (window.parent && window.parent.document) {
        const step3Tab = window.parent.document.getElementById('tab-step3');
        if (step3Tab) step3Tab.click();
    }
}

document.getElementById('red-on').addEventListener('click', () => turnOn(1)); document.getElementById('red-off').addEventListener('click', () => turnOff(1));
document.getElementById('green-on').addEventListener('click', () => turnOn(2)); document.getElementById('green-off').addEventListener('click', () => turnOff(2));
document.getElementById('blue-on').addEventListener('click', () => turnOn(4)); document.getElementById('blue-off').addEventListener('click', () => turnOff(4));
document.getElementById('end-btn').addEventListener('click', endApp);

render();
