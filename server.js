const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let players = {};
let bots = {};
let bullets = [];
let logs = [];

// نظام النقاط والجولات للفرق
let score = { blue: 0, red: 0 };
let gameStatus = "active"; // active أو finished

const MAP = { width: 800, height: 600, color: '#111' };

function addLog(text) {
    logs.push({ text, id: Date.now() });
    if (logs.length > 5) logs.shift();
}

// توليد البوتات وتوزيعها على الفرق بالتساوي لضمان حركة وإطلاق نار مستمر
function spawnBots() {
    bots = {};
    // بوت للفريق الأزرق وبوتين للفريق الأحمر (أو العكس حسب الوضع)
    bots['bot_1'] = { x: 100, y: 150, name: "آلي_أزرق", hp: 100, isBot: true, team: "blue", vx: 3, vy: 2, lastShot: 0 };
    bots['bot_2'] = { x: 700, y: 450, name: "آلي_أحمر_1", hp: 100, isBot: true, team: "red", vx: -3, vy: -2, lastShot: 0 };
    bots['bot_3'] = { x: 700, y: 150, name: "آلي_أحمر_2", hp: 100, isBot: true, team: "red", vx: -2, vy: 3, lastShot: 0 };
}

// دالة التحقق من انتهاء الجولة أو اللعبة كاملة
function checkRoundEnd() {
    if (gameStatus !== "active") return;

    let blueAlive = false;
    let redAlive = false;

    // فحص اللاعبين الحقيقيين
    for (let id in players) {
        if (players[id].hp > 0) {
            if (players[id].team === "blue") blueAlive = true;
            if (players[id].team === "red") redAlive = true;
        }
    }
    // فحص البوتات إذا كان اللعب فردي
    for (let id in bots) {
        if (bots[id].hp > 0) {
            if (bots[id].team === "blue") blueAlive = true;
            if (bots[id].team === "red") redAlive = true;
        }
    }

    // إذا مات أحد الفريقين بالكامل
    if (!blueAlive || !redAlive) {
        let roundWinner = !blueAlive ? "الحمر" : "الزرق";
        let teamKey = !blueAlive ? "red" : "blue";
        
        score[teamKey]++;
        addLog(`🎉 فاز الفريق ${roundWinner} بالجولة!`);

        if (score[teamKey] >= 5) {
            gameStatus = "finished";
            addLog(`🏆 النصر النهائي للفريق ${roundWinner} (5 جولات)!`);
            setTimeout(resetEntireGame, 5000); // إعادة تشغيل اللعبة بالكامل بعد 5 ثواني
        } else {
            gameStatus = "intermission";
            setTimeout(resetRound, 3000); // جولة جديدة بعد 3 ثواني
        }
    }
}

// إعادة تصفير الجولة الحالية وإحياء الجميع في أماكنهم الأصلية
function resetRound() {
    for (let id in players) {
        players[id].hp = 100;
        players[id].x = players[id].team === "blue" ? 100 + Math.random()*100 : 600 + Math.random()*100;
        players[id].y = 100 + Math.random()*400;
    }
    for (let id in bots) {
        bots[id].hp = 100;
        bots[id].x = bots[id].team === "blue" ? 100 + Math.random()*100 : 600 + Math.random()*100;
        bots[id].y = 100 + Math.random()*400;
    }
    bullets = [];
    gameStatus = "active";
    addLog("⚔️ بدأت جولة جديدة! انطلقوا!");
}

// إعادة تصفير اللعبة بالكامل عند وصول فريق لـ 5 فوز
function deleteEverything() {
    score = { blue: 0, red: 0 };
    resetRound();
}
function resetEntireGame() {
    score = { blue: 0, red: 0 };
    resetRound();
}

io.on('connection', (socket) => {
    // تحديد الفريق تلقائياً بناءً على عدد اللاعبين المتصلين للحفاظ على التوازن
    let blueCount = Object.values(players).filter(p => p.team === "blue").length;
    let redCount = Object.values(players).filter(p => p.team === "red").length;
    let assignedTeam = blueCount <= redCount ? "blue" : "red";

    players[socket.id] = {
        x: assignedTeam === "blue" ? 150 : 650,
        y: 300,
        name: "جندي",
        hp: 100,
        team: assignedTeam,
        gameMode: 'multi',
        movement: {}
    };

    socket.on('initGame', (data) => {
        if(players[socket.id]) {
            players[socket.id].name = data.name;
            players[socket.id].gameMode = data.mode;
            addLog(`📢 انضم ${data.name} للفريق ${data.team === 'blue' ? 'الأزرق' : 'الأحمر'}`);
            
            if(data.mode === 'single') {
                // في اللعب الفردي نجعل اللاعب دائماً أزرق والبوتات ضدة في الأحمر
                players[socket.id].team = "blue";
                players[socket.id].x = 150;
                spawnBots();
            }
            // إرسال كود الفريق للاعب لتأكيده في الواجهة
            socket.emit('teamAssignment', players[socket.id].team);
        }
    });

    socket.on('movement', (data) => {
        if (players[socket.id] && gameStatus === "active") players[socket.id].movement = data;
    });

    socket.on('shoot', (target) => {
        let p = players[socket.id];
        if (p && p.hp > 0 && gameStatus === "active") {
            let angle = Math.atan2(target.targetY - p.y, target.targetX - p.x);
            bullets.push({
                x: p.x, y: p.y,
                vx: Math.cos(angle) * 10,
                vy: Math.sin(angle) * 10,
                ownerId: socket.id,
                team: p.team // الرصاص ينتمي للفريق لمنع إيذاء أعضاء نفس الفريق
            });
            io.emit('playShootSound');
        }
    });

    socket.on('chatMessage', (msg) => {
        let p = players[socket.id];
        if(p) {
            io.emit('chatUpdate', { name: p.name, text: msg, team: p.team });
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            addLog(`❌ غادر ${players[socket.id].name}`);
            delete players[socket.id];
            checkRoundEnd();
        }
    });
});

// حلقة اللعبة (60 إطار في الثانية)
setInterval(() => {
    let activePlayers = {};
    let isSingleMode = false;

    for (let id in players) {
        let p = players[id];
        if (p.gameMode === 'single') isSingleMode = true;
        
        if (p.hp > 0 && gameStatus === "active") {
            if (p.movement.up && p.y > 20) p.y -= 4;
            if (p.movement.down && p.y < 580) p.y += 4;
            if (p.movement.left && p.x > 20) p.x -= 4;
            if (p.movement.right && p.x < 780) p.x += 4;
        }
        activePlayers[id] = p;
    }

    // تحركات وإطلاق نار البوتات
    if(isSingleMode) {
        for(let id in bots) {
            let b = bots[id];
            if(b.hp <= 0) continue;

            if (gameStatus === "active") {
                b.x += b.vx;
                b.y += b.vy;
                if(b.x < 30 || b.x > 770) b.vx *= -1;
                if(b.y < 30 || b.y > 570) b.vy *= -1;

                // ذكاء اصطناعي: البوت يطلق على الفريق الخصم فقط
                let now = Date.now();
                if(now - b.lastShot > 1400) { 
                    for(let pId in players) {
                        let p = players[pId];
                        if(p.hp > 0 && p.team !== b.team) {
                            let angle = Math.atan2(p.y - b.y, p.x - b.x);
                            bullets.push({
                                x: b.x, y: b.y,
                                vx: Math.cos(angle) * 8,
                                vy: Math.sin(angle) * 8,
                                ownerId: id,
                                team: b.team
                            });
                            io.emit('playShootSound');
                            b.lastShot = now;
                            break;
                        }
                    }
                }
            }
            activePlayers[id] = b;
        }
    }

    // تحديث الرصاص وفحص التصادم وضرر النيران الصديقة
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        let bulletRemoved = false;

        for (let id in activePlayers) {
            let p = activePlayers[id];
            // الرصاص يضرب الأعداء فقط (team !== b.team)
            if (p.hp > 0 && p.team !== b.team) {
                let dist = Math.hypot(b.x - p.x, b.y - p.y);
                if (dist < 20) {
                    p.hp -= 25; // طلقة تميت بـ 4 ضربات
                    bullets.splice(i, 1);
                    bulletRemoved = true;

                    if (p.hp <= 0) {
                        let killer = activePlayers[b.ownerId] ? activePlayers[b.ownerId].name : "مجهول";
                        addLog(`💀 ${killer} قَضى على ${p.name}`);
                        
                        // إرسال حدث الموت الخاص باللاعب الحقيقي لتشغيل صوت الخسارة
                        if (!p.isBot) {
                            io.to(id).emit('playerDied');
                        }
                        
                        checkRoundEnd(); // فحص هل انتهت الجولة بموت هذا الشخص
                    }
                    break;
                }
            }
        }

        if (bulletRemoved) continue;
        if (b.x < 0 || b.x > 800 || b.y < 0 || b.y > 600) bullets.splice(i, 1);
    }

    io.emit('state', { players: activePlayers, bullets, logs, mapConfig: MAP, score });
}, 1000 / 60);

server.listen(3000, () => console.log('السيرفر جاهز على http://localhost:3000'));
