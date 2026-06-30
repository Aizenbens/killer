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
let bullets = [];
let logs = [];
let score = { blue: 0, red: 0 };
let gameStatus = "active"; 

// إحداثيات العقبات في الغابة
const OBSTACLES = [
    { x: 400, y: 300, w: 60, h: 60 },
    { x: 200, y: 150, w: 50, h: 50 },
    { x: 200, y: 450, w: 50, h: 50 },
    { x: 600, y: 150, w: 50, h: 50 },
    { x: 600, y: 450, w: 50, h: 50 }
];

const MAP = { width: 800, height: 600, color: '#1b4d3e' };

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
    addLog("⚔️ بدأت جولة جديدة في الغابة!");
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
        name: "جندي",
        hp: 100,
        team: assignedTeam,
        angle: 0,
        isMoving: false,
        damaged: false, // خاصية لتتبع وميض الضرر
        movement: {}
    };

    socket.on('initGame', (data) => {
        if(players[socket.id]) {
            players[socket.id].name = data.name;
            addLog(`📢 انضم ${data.name} للفريق ${players[socket.id].team === 'blue' ? 'الأزرق' : 'الأحمر'}`);
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
            p.angle = angle; 
            
            bullets.push({
                x: p.x + Math.cos(angle) * 25, 
                y: p.y + Math.sin(angle) * 25,
                vx: Math.cos(angle) * 12,
                vy: Math.sin(angle) * 12,
                ownerId: socket.id,
                team: p.team
            });
            io.emit('playShootSound');
        }
    });

    socket.on('chatMessage', (msg) => {
        let p = players[socket.id];
        if(p) io.emit('chatUpdate', { name: p.name, text: msg, team: p.team });
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            addLog(`❌ غادر ${players[socket.id].name}`);
            delete players[socket.id];
            checkRoundEnd();
        }
    });
});

// حلقة اللعبة
setInterval(() => {
    for (let id in players) {
        let p = players[id];
        if (p.hp > 0 && gameStatus === "active") {
            let oldX = p.x;
            let oldY = p.y;
            
            p.isMoving = false;
            if (p.movement.up) { p.y -= 4; p.isMoving = true; }
            if (p.movement.down) { p.y += 4; p.isMoving = true; }
            if (p.movement.left) { p.x -= 4; p.isMoving = true; }
            if (p.movement.right) { p.x += 4; p.isMoving = true; }

            if (p.movement.left) p.angle = Math.PI;
            else if (p.movement.right) p.angle = 0;
            else if (p.movement.up) p.angle = -Math.PI / 2;
            else if (p.movement.down) p.angle = Math.PI / 2;

            if (checkObstacleCollision(p.x, p.y, 15)) {
                p.x = oldX;
                p.y = oldY;
                p.isMoving = false;
            }
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
                    p.damaged = true; // تفعيل وميض الضرر
                    
                    bullets.splice(i, 1);
                    bulletRemoved = true;

                    // إلغاء وميض الضرر بعد 150 مللي ثانية تلقائياً عبر حدث العميل
                    setTimeout(() => { if(players[id]) players[id].damaged = false; }, 150);

                    if (p.hp <= 0) {
                        let killer = players[b.ownerId] ? players[b.ownerId].name : "مجهول";
                        addLog(`💀 ${killer} قَضى على ${p.name}`);
                        io.to(id).emit('playerDied');
                        checkRoundEnd(); 
                    }
                    break;
                }
            }
        }

        if (bulletRemoved) continue;
        if (b.x < 0 || b.x > 800 || b.y < 0 || b.y > 600) bullets.splice(i, 1);
    }

    io.emit('state', { players, bullets, logs, obstacles: OBSTACLES, score });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`السيرفر يعمل على البورت ${PORT}`));
