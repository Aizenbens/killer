const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// تقديم كافة الملفات الثابتة من المجلد الرئيسي مباشرة
app.use(express.static(__dirname));

// توجيه الصفحة الرئيسية إلى index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let players = {};
let bullets = [];
let logs = [];
let score = { blue: 0, red: 0 };
let gameStatus = "active";

const OBSTACLES = [
    { x: 400, y: 300, w: 60, h: 60 },
    { x: 200, y: 150, w: 50, h: 50 },
    { x: 200, y: 450, w: 50, h: 50 },
    { x: 600, y: 150, w: 50, h: 50 },
    { x: 600, y: 450, w: 50, h: 50 }
];

function addLog(text) {
    logs.push({ text, id: Date.now() });
    if (logs.length > 5) logs.shift();
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

    let totalPlayers = Object.keys(players).length;
    if (totalPlayers > 1 && (!blueAlive || !redAlive)) {
        let roundWinner = blueAlive ? "الزرقاء" : "الحمراء";
        let teamKey = blueAlive ? "blue" : "red";

        score[teamKey]++;
        addLog(`🏆 فاز فريق ${roundWinner} بالجولة`);

        if (score[teamKey] >= 5) {
            gameStatus = "finished";
            addLog(`🥇 النصر النهائي لـ ${roundWinner} (5 جولات)`);
            setTimeout(resetEntireGame, 5000);
        } else {
            gameStatus = "intermission";
            setTimeout(resetRound, 3000);
        }
    }
}

function resetRound() {
    for (let id in players) {
        players[id].hp = 100;
        players[id].x = players[id].team === "blue" ? 150 : 650;
        players[id].y = 200 + Math.random() * 200;
        players[id].damaged = false;
    }
    bullets = [];
    gameStatus = "active";
    addLog("⚔️ جولة جديدة بدأت في ساحة الرشاقة!");
}

function resetEntireGame() {
    score = { blue: 0, red: 0 };
    resetRound();
}

function checkObstacleCollision(x, y, radius) {
    for (let obs of OBSTACLES) {
        if (x + radius > obs.x - obs.w/2 && x - radius < obs.x + obs.w/2 &&
            y + radius > obs.y - obs.h/2 && y - radius < obs.y + obs.h/2) {
            return true;
        }
    }
    return false;
}

io.on('connection', (socket) => {
    let blueCount = Object.values(players).filter(p => p.team === "blue").length;
    let redCount = Object.values(players).filter(p => p.team === "red").length;
    let assignedTeam = blueCount <= redCount ? "blue" : "red";

    players[socket.id] = {
        x: assignedTeam === "blue" ? 150 : 650,
        y: 300,
        name: "",
        hp: 100,
        team: assignedTeam,
        angle: 0,
        isMoving: false,
        damaged: false,
        movement: {}
    };

    socket.on('initGame', (data) => {
        if (players[socket.id]) {
            players[socket.id].name = data.name || "مقاتل";
        }
    });

    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            players[socket.id].movement = data.movement;
            players[socket.id].angle = data.angle;
        }
    });

    socket.on('shoot', (data) => {
        if (players[socket.id] && players[socket.id].hp > 0) {
            bullets.push({
                x: players[socket.id].x,
                y: players[socket.id].y,
                vx: Math.cos(data.angle) * 7,
                vy: Math.sin(data.angle) * 7,
                ownerId: socket.id,
                team: players[socket.id].team
            });
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        checkRoundEnd();
    });
});

// تحديث حركة اللاعبين والرصاص بـ 60 FPS
setInterval(() => {
    for (let id in players) {
        let p = players[id];
        if (p.hp <= 0) continue;

        let oldX = p.x;
        let oldY = p.y;
        p.isMoving = false;

        if (p.movement.up) { p.y -= 4; p.isMoving = true; }
        if (p.movement.down) { p.y += 4; p.isMoving = true; }
        if (p.movement.left) { p.x -= 4; p.isMoving = true; }
        if (p.movement.right) { p.x += 4; p.isMoving = true; }

        if (checkObstacleCollision(p.x, p.y, 15)) {
            p.x = oldX;
            p.y = oldY;
            p.isMoving = false;
        }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        if (checkObstacleCollision(b.x, b.y, 5)) {
            bullets.splice(i, 1);
            continue;
        }

        let bulletRemoved = false;
        for (let id in players) {
            let p = players[id];
            if (p.hp > 0 && p.team !== b.team) {
                let dist = Math.hypot(b.x - p.x, b.y - p.y);
                if (dist < 20) {
                    p.hp -= 25;
                    p.damaged = true;
                    bullets.splice(i, 1);
                    bulletRemoved = true;

                    setTimeout(() => { if (players[id]) players[id].damaged = false; }, 150);

                    if (p.hp <= 0) {
                        let killer = players[b.ownerId] ? players[b.ownerId].name : "مجهول";
                        addLog(`💀 قضى ${killer} على ${p.name}`);
                        io.to(id).emit('playerDied');
                        checkRoundEnd();
                    }
                    break;
                }
            }
        }

        if (bulletRemoved) continue;
        if (b.x < 0 || b.x > 800 || b.y < 0 || b.y > 600) {
            bullets.splice(i, 1);
        }
    }

    io.emit('state', { players, bullets, logs, obstacles: OBSTACLES, score });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل على البورت ${PORT}`);
});
