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
let currentMap = 'العادية';

const MAPS = {
    'العادية': { width: 800, height: 600, color: '#111' },
    'الصحراء': { width: 800, height: 600, color: '#3a2f1d' },
    'المصنع': { width: 800, height: 600, color: '#1e252b' }
};

function addLog(text) {
    logs.push({ text, id: Date.now() });
    if (logs.length > 5) logs.shift();
}

// دالة لتوليد البوتات للعب الفردي
function spawnBots() {
    bots = {};
    for(let i=1; i<=3; i++) {
        bots['bot_' + i] = {
            x: Math.random() * 700 + 50,
            y: Math.random() * 500 + 50,
            name: `آلي_${i}`,
            hp: 100,
            isBot: true,
            vx: (Math.random() - 0.5) * 3,
            vy: (Math.random() - 0.5) * 3,
            lastShot: 0
        };
    }
}

io.on('connection', (socket) => {
    players[socket.id] = {
        x: Math.random() * 700,
        y: Math.random() * 500,
        name: "لاعب_جديد",
        hp: 100,
        gameMode: 'multi',
        movement: {}
    };

    socket.on('initGame', (data) => {
        if(players[socket.id]) {
            players[socket.id].name = data.name;
            players[socket.id].gameMode = data.mode;
            currentMap = data.map;
            addLog(`📢 انضم ${data.name} إلى اللعبة`);
            
            if(data.mode === 'single') {
                spawnBots();
            }
        }
    });

    socket.on('movement', (data) => {
        if (players[socket.id]) players[socket.id].movement = data;
    });

    socket.on('shoot', (target) => {
        let p = players[socket.id];
        if (p && p.hp > 0) {
            let angle = Math.atan2(target.targetY - p.y, target.targetX - p.x);
            bullets.push({
                x: p.x, y: p.y,
                vx: Math.cos(angle) * 10,
                vy: Math.sin(angle) * 10,
                ownerId: socket.id
            });
            io.emit('playShootSound'); // إرسال أمر تشغيل الصوت للجميع
        }
    });

    // استقبال رسائل الدردشة وإعادة توجيهها للأطراف
    socket.on('chatMessage', (msg) => {
        let p = players[socket.id];
        if(p) {
            io.emit('chatUpdate', { name: p.name, text: msg });
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            addLog(`❌ غادر ${players[socket.id].name}`);
            delete players[socket.id];
        }
    });
});

// ميزة العلاج التلقائي كل 3 ثواني
setInterval(() => {
    for (let id in players) {
        if (players[id].hp > 0 && players[id].hp < 100) players[id].hp = Math.min(100, players[id].hp + 5);
    }
    for (let id in bots) {
        if (bots[id].hp > 0 && bots[id].hp < 100) bots[id].hp = Math.min(100, bots[id].hp + 5);
    }
}, 3000);

// حلقة اللعبة الأساسية (60 إطار في الثانية)
setInterval(() => {
    let activePlayers = {};
    let isSingleMode = false;

    for (let id in players) {
        let p = players[id];
        if (p.gameMode === 'single') isSingleMode = true;
        
        if (p.hp > 0) {
            if (p.movement.up && p.y > 20) p.y -= 4;
            if (p.movement.down && p.y < 580) p.y += 4;
            if (p.movement.left && p.x > 20) p.x -= 4;
            if (p.movement.right && p.x < 780) p.x += 4;
        }
        activePlayers[id] = p;
    }

    // إدارة الذكاء الاصطناعي (البوتات) في الطور الفردي
    if(isSingleMode) {
        for(let id in bots) {
            let b = bots[id];
            if(b.hp <= 0) continue;

            // حركة عشوائية ذكية
            b.x += b.vx;
            b.y += b.vy;
            if(b.x < 30 || b.x > 770) b.vx *= -1;
            if(b.y < 30 || b.y > 570) b.vy *= -1;

            // إطلاق نار تلقائي على اللاعبين القريبين كل ثانية ونصف
            let now = Date.now();
            if(now - b.lastShot > 1500) {
                for(let pId in players) {
                    let p = players[pId];
                    if(p.hp > 0) {
                        let angle = Math.atan2(p.y - b.y, p.x - b.x);
                        bullets.push({
                            x: b.x, y: b.y,
                            vx: Math.cos(angle) * 7,
                            vy: Math.sin(angle) * 7,
                            ownerId: id
                        });
                        io.emit('playShootSound');
                        b.lastShot = now;
                        break;
                    }
                }
            }
            activePlayers[id] = b;
        }
    }

    // تحديث حركة وفحص تصادم الرصاص
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        let bulletRemoved = false;

        for (let id in activePlayers) {
            let p = activePlayers[id];
            if (id !== b.ownerId && p.hp > 0) {
                let dist = Math.hypot(b.x - p.x, b.y - p.y);
                if (dist < 20) { // تصادم دائري (نصف قطر اللاعب 15)
                    p.hp -= 20;
                    bullets.splice(i, 1);
                    bulletRemoved = true;

                    if (p.hp <= 0) {
                        let killer = activePlayers[b.ownerId] ? activePlayers[b.ownerId].name : "مجهول";
                        addLog(`💀 ${killer} قَضى على ${p.name}`);
                        
                        setTimeout(() => {
                            if (players[id]) { players[id].hp = 100; players[id].x = Math.random()*700; players[id].y = Math.random()*500; }
                            if (bots[id]) { bots[id].hp = 100; bots[id].x = Math.random()*700; bots[id].y = Math.random()*500; }
                        }, 3000);
                    }
                    break;
                }
            }
        }

        if (bulletRemoved) continue;
        if (b.x < 0 || b.x > 800 || b.y < 0 || b.y > 600) bullets.splice(i, 1);
    }

    io.emit('state', { players: activePlayers, bullets, logs, mapConfig: MAPS[currentMap] });
}, 1000 / 60);

server.listen(3000, () => console.log('السيرفر جاهز على http://localhost:3000'));
