const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let players = {};
let bullets = [];
let logs = []; // لتخزين إشعارات الدخول والخروج والقتل

// دالة لإضافة إشعار وحذف القديم تلقائياً
function addLog(text) {
    logs.push({ text, id: Date.now() });
    if (logs.length > 5) logs.shift(); // الاحتفاظ بآخر 5 إشعارات فقط
}

io.on('connection', (socket) => {
    // إعطاء اسم عشوائي مؤقت للاعب فور دخوله
    const playerName = "لاعب_" + Math.floor(1000 + Math.random() * 9000);
    addLog(`📢 انضم ${playerName} إلى اللعبة`);

    players[socket.id] = {
        x: Math.random() * 700,
        y: Math.random() * 500,
        name: playerName,
        hp: 100, // الصحة الكاملة
        movement: {}
    };

    // استقبال الاسم المعدل من اللاعب
    socket.on('setPlayerName', (name) => {
        if(name && name.trim() !== "" && players[socket.id]) {
            const oldName = players[socket.id].name;
            players[socket.id].name = name;
            // تحديث إشعار الدخول بالاسم الجديد
            logs = logs.filter(l => !l.text.includes(oldName));
            addLog(`📢 انضم ${name} إلى اللعبة`);
        }
    });

    socket.on('movement', (data) => {
        if (players[socket.id]) players[socket.id].movement = data;
    });

    socket.on('shoot', (target) => {
        let p = players[socket.id];
        if (p && p.hp > 0) { // اللاعب الميت لا يمكنه إطلاق النار
            let angle = Math.atan2(target.targetY - p.y, target.targetX - p.x);
            bullets.push({
                x: p.x + 12,
                y: p.y + 12,
                vx: Math.cos(angle) * 8,
                vy: Math.sin(angle) * 8,
                ownerId: socket.id
            });
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            addLog(`❌ غادر ${players[socket.id].name} اللعبة`);
            delete players[socket.id];
        }
    });
});

// ميزة العلاج التلقائي: كل 3 ثوانٍ يزداد اللاعب 5 نقاط صحة (ما يعادل تعافي من ربع طلقة تقريباً)
setInterval(() => {
    for (let id in players) {
        let p = players[id];
        if (p.hp > 0 && p.hp < 100) {
            p.hp = Math.min(100, p.hp + 5); // زيادة الصحة بحد أقصى 100
        }
    }
}, 3000);

// حلقة تحديث اللعبة (Game Loop) - 60 إطار في الثانية
setInterval(() => {
    // حركة اللاعبين
    for (let id in players) {
        let p = players[id];
        if (p.hp <= 0) continue; // إذا مات لا يتحرك
        if (p.movement.up && p.y > 0) p.y -= 4;
        if (p.movement.down && p.y < 575) p.y += 4;
        if (p.movement.left && p.x > 0) p.x -= 4;
        if (p.movement.right && p.x < 775) p.x += 4;
    }

    // حركة الطلقات وفحص التصادم
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        let bulletRemoved = false;

        // فحص التصادم مع كل لاعب
        for (let id in players) {
            let p = players[id];
            
            // لا تطلق على نفسك، ولا تطلق على لاعب ميت
            if (id !== b.ownerId && p.hp > 0) {
                // فحص إذا كانت الطلقة داخل مربع اللاعب (حجم اللاعب 25x25)
                if (b.x >= p.x && b.x <= p.x + 25 && b.y >= p.y && b.y <= p.y + 25) {
                    p.hp -= 20; // نقص الدم بمقدار 20 (5 طلقات تقتل)
                    bullets.splice(i, 1);
                    bulletRemoved = true;

                    // إذا مات اللاعب
                    if (p.hp <= 0) {
                        let killerName = players[b.ownerId] ? players[b.ownerId].name : "مجهول";
                        addLog(`💀 قَتَل ${killerName} اللاعب ${p.name}`);
                        
                        // إعادة إحياء (Respawn) بعد 3 ثوانٍ
                        setTimeout(() => {
                            if (players[id]) {
                                players[id].hp = 100;
                                players[id].x = Math.random() * 700;
                                players[id].y = Math.random() * 500;
                                addLog(`🔄 عاد ${players[id].name} للحياة`);
                            }
                        }, 3000);
                    }
                    break;
                }
            }
        }

        if (bulletRemoved) continue;

        // حذف الطلقة إذا خرجت من الحدود
        if (b.x < 0 || b.x > 800 || b.y < 0 || b.y > 600) {
            bullets.splice(i, 1);
        }
    }

    io.emit('state', { players, bullets, logs });
}, 1000 / 60);

server.listen(3000, () => {
    console.log('السيرفر يعمل على http://localhost:3000');
});
