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

io.on('connection', (socket) => {
    console.log('لاعب جديد اتصل: ' + socket.id);
    
    // إنشاء لاعب جديد بموقع عشوائي
    players[socket.id] = { x: Math.random() * 700, y: Math.random() * 500, movement: {} };

    // استقبال الحركة من اللاعب
    socket.on('movement', (data) => {
        if (players[socket.id]) players[socket.id].movement = data;
    });

    // استقبال أمر إطلاق النار
    socket.on('shoot', (target) => {
        let p = players[socket.id];
        if (p) {
            let angle = Math.atan2(target.targetY - p.y, target.targetX - p.x);
            bullets.push({
                x: p.x + 10,
                y: p.y + 10,
                vx: Math.cos(angle) * 7,
                vy: Math.sin(angle) * 7,
                id: socket.id
            });
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        console.log('لاعب غادر: ' + socket.id);
    });
});

// تحديث اللعبة 60 مرة في الثانية (Game Loop)
setInterval(() => {
    // تحديث مكان اللاعبين
    for (let id in players) {
        let p = players[id];
        if (p.movement.up) p.y -= 4;
        if (p.movement.down) p.y += 4;
        if (p.movement.left) p.x -= 4;
        if (p.movement.right) p.x += 4;
    }

    // تحديث مكان الطلقات
    bullets.forEach((b, index) => {
        b.x += b.vx;
        b.y += b.vy;
        // حذف الطلقة إذا خرجت عن الشاشة
        if (b.x < 0 || b.x > 800 || b.y < 0 || b.y > 600) {
            bullets.splice(index, 1);
        }
    });

    // إرسال الوضع الحالي لكل اللاعبين
    io.emit('state', { players, bullets });
}, 1000 / 60);

server.listen(3000, () => {
    console.log('السيرفر يعمل على المنفذ http://localhost:3000');
});
