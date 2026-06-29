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
let score = { blue: 0, red: 0 };
let gameStatus = "active"; 

const MAP = { width: 800, height: 600, color: '#111' };

function addLog(text) {
    logs.push({ text, id: Date.now() });
    if (logs.length > 5) logs.shift();
}

// تخصيص توليد البوتات بناءً على طلبك
function spawnBots(mode) {
    bots = {};
    if (mode === 'single') {
        // الوضع الفردي: اللاعب وحده ضد 3 بوتات حمراء تهاجمه هو فقط
        bots['bot_r1'] = { x: 700, y: 150, name: "آلي_أحمر_1", hp: 100, isBot: true, team: "red", lastShot: 0 };
        bots['bot_r2'] = { x: 700, y: 300, name: "آلي_أحمر_2", hp: 100, isBot: true, team: "red", lastShot: 0 };
        bots['bot_r3'] = { x: 700, y: 450, name: "آلي_أحمر_3", hp: 100, isBot: true, team: "red", lastShot: 0 };
    } else {
        // الوضع الجماعي: بوت محترف لكل فريق لدعم اللاعبين
        bots['bot_m1'] = { x: 150, y: 150, name: "محترف_أزرق", hp: 100, isBot: true, team: "blue", lastShot: 0 };
        bots['bot_m2'] = { x: 650, y: 450, name: "محترف_أحمر", hp: 100, isBot: true, team: "red", lastShot: 0 };
    }
}

function checkRoundEnd() {
    if (gameStatus !== "active") return;

    let blueAlive = false;
    let redAlive = false;

    for (let id in players) {
        if (players[id].hp > 0) {
            if (players[id].team === "blue") blueAlive = true;
            if (players[id].team === "red") redAlive = true;
        }
    }
    for (let id in bots) {
        if (bots[id].hp > 0) {
            if (bots[id].team === "blue") blueAlive = true;
            if (bots[id].team === "red") redAlive = true;
        }
    }

    if (!blueAlive || !redAlive) {
        let roundWinner = !blueAlive ? "الحمر" : "الزرق";
        let teamKey = !blueAlive ? "red" : "blue";
        
        score[teamKey]++;
        addLog(`🎉 فاز الفريق ${roundWinner} بالجولة!`);

        if (score[teamKey] >= 5) {
            gameStatus = "finished";
            addLog(`🏆 النصر النهائي للفريق ${roundWinner} (5 جولات)!`);
            setTimeout(resetEntireGame, 5000);
        } else {
            gameStatus = "intermission";
            let currentMode = Object.values(players)[0]?.gameMode || 'multi';
            setTimeout(() => resetRound(currentMode), 3000);
        }
    }
}

function resetRound(mode) {
    for (let id in players) {
        players[id].hp = 100;
        players[id].x = players[id].team === "blue" ? 150 : 650;
        players[id].y = 200 + Math.random() * 200;
    }
    spawnBots(mode);
    bullets = [];
    gameStatus = "active";
    addLog("⚔️ بدأت جولة جديدة! انطلقوا!");
}

function resetEntireGame() {
    score = { blue: 0, red: 0 };
    let currentMode = Object.values(players)[0]?.gameMode || 'multi';
    resetRound(currentMode);
}

io.on('connection', (socket) => {
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
            
            if(data.mode === 'single') {
                players[socket.id].team = "blue"; // في اللعب الفردي اللاعب دائماً أزرق وحده
                players[socket.id].x = 150;
                players[socket.id].y = 300;
            }
            
            addLog(`📢 انضم ${data.name} للفريق ${players[socket.id].team === 'blue' ? 'الأزرق' : 'الأحمر'}`);
            spawnBots(data.mode);
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
                vx: Math.cos(angle) * 11,
                vy: Math.sin(angle) * 11,
                ownerId: socket.id,
                team: p.team
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

// حلقة اللعبة (60 إطار في الثانية) مع ذكاء اصطناعي محترف لملاحقة اللاعب
setInterval(() => {
    let activePlayers = {};

    for (let id in players) {
        let p = players[id];
        if (p.hp > 0 && gameStatus === "active") {
            if (p.movement.up && p.y > 20) p.y -= 4;
            if (p.movement.down && p.y < 580) p.y += 4;
            if (p.movement.left && p.x > 20) p.x -= 4;
            if (p.movement.right && p.x < 780) p.x += 4;
        }
        activePlayers[id] = p;
    }

    // حركة البوتات المحترفة لملاحقة وحصار الخصوم حركياً وبصرياً
    for (let id in bots) {
        let b = bots[id];
        if (b.hp <= 0) continue;

        if (gameStatus === "active") {
            let closestEnemy = null;
            let minDist = Infinity;

            for (let targetId in players) {
                let target = players[targetId];
                if (target.hp > 0 && target.team !== b.team) {
                    let dist = Math.hypot(target.x - b.x, target.y - b.y);
                    if (dist < minDist) { minDist = dist; closestEnemy = target; }
                }
            }
            for (let targetId in bots) {
                let target = bots[targetId];
                if (target.hp > 0 && target.team !== b.team) {
                    let dist = Math.hypot(target.x - b.x, target.y - b.y);
                    if (dist < minDist) { minDist = dist; closestEnemy = target; }
                }
            }

            if (closestEnemy) {
                let angle = Math.atan2(closestEnemy.y - b.y, closestEnemy.x - b.x);
                let speed = 2.5; 
                
                if (minDist > 180) {
                    b.x += Math.cos(angle) * speed;
                    b.y += Math.sin(angle) * speed;
                } else {
                    b.x += Math.cos(angle + Math.PI/2) * (speed * 0.8);
                    b.y += Math.sin(angle + Math.PI/2) * (speed * 0.8);
                }

                b.x = Math.max(25, Math.min(775, b.x));
                b.y = Math.max(25, Math.min(575, b.y));

                let now = Date.now();
                if (now - b.lastShot > 1100) {
                    bullets.push({
                        x: b.x, y: b.y,
                        vx: Math.cos(angle) * 9,
                        vy: Math.sin(angle) * 9,
                        ownerId: id,
                        team: b.team
                    });
                    io.emit('playShootSound');
                    b.lastShot = now;
                }
            }
        }
        activePlayers[id] = b;
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        let bulletRemoved = false;

        for (let id in activePlayers) {
            let p = activePlayers[id];
            if (p.hp > 0 && p.team !== b.team) {
                let dist = Math.hypot(b.x - p.x, b.y - p.y);
                if (dist < 20) {
                    p.hp -= 25; 
                    bullets.splice(i, 1);
                    bulletRemoved = true;

                    if (p.hp <= 0) {
                        let killer = activePlayers[b.ownerId] ? activePlayers[b.ownerId].name : "مجهول";
                        addLog(`💀 ${killer} قَضى على ${p.name}`);
                        
                        if (!p.isBot) {
                            io.to(id).emit('playerDied');
                        }
                        checkRoundEnd(); 
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
