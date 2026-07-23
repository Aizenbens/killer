const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// تقديم ملفات اللعبة تلقائياً من مجلد public
app.use(express.static(path.join(__dirname, 'public')));

// تخزين قائمة اللاعبين المتصلين في السيرفر
const players = {};

io.on('connection', (socket) => {
    console.log(`[+] لاعب جديد اتصل باللعبة: ${socket.id}`);

    // إرسال قائمة اللاعبين الحالية للاعب المتصل حديثاً
    socket.emit('currentPlayers', players);

    // استقبال حدث انضمام اللاعب للعبة
    socket.on('joinGame', (playerData) => {
        players[socket.id] = {
            id: socket.id,
            name: playerData.name || 'مقاتل',
            x: playerData.x || 1250,
            y: playerData.y || 34,
            z: playerData.z || 1250,
            yaw: playerData.yaw || 0,
            health: 100,
            kills: 0,
            deaths: 0
        };

        // إعلام جميع اللاعبين الآخرين بوفود لاعب جديد
        socket.broadcast.emit('playerJoined', players[socket.id]);
    });

    // استقبال تحديث الحركة والموقع ثلاثي الأبعاد
    socket.on('playerMove', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].yaw = movementData.yaw;

            // إعادة بث الحركة المحدثة لجميع المتصلين الآخرين
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                x: movementData.x,
                y: movementData.y,
                z: movementData.z,
                yaw: movementData.yaw
            });
        }
    });

    // استقبال حدث إطلاق النار ومزامنة المقذوفات/الرصاص
    socket.on('shoot', (shootData) => {
        socket.broadcast.emit('playerShot', {
            id: socket.id,
            origin: shootData.origin,
            target: shootData.target,
            weaponId: shootData.weaponId
        });
    });

    // استقبال حدث إلحاق الضرر بلاعب آخر
    socket.on('playerHit', (hitData) => {
        const targetPlayer = players[hitData.targetId];
        if (targetPlayer) {
            targetPlayer.health -= hitData.damage;
            
            if (targetPlayer.health <= 0) {
                targetPlayer.health = 0;
                targetPlayer.deaths += 1;

                if (players[socket.id]) {
                    players[socket.id].kills += 1;
                }

                // إرسال حدث القضاء على اللاعب للجميع
                io.emit('playerDied', {
                    victimId: hitData.targetId,
                    killerId: socket.id,
                    killerName: players[socket.id] ? players[socket.id].name : 'مجهول',
                    victimName: targetPlayer.name
                });
            } else {
                // إرسال تحديث الصحة المتبقية
                io.emit('healthUpdate', {
                    id: hitData.targetId,
                    health: targetPlayer.health
                });
            }
        }
    });

    // استقبال وإعادة إرسال رسائل الشات
    socket.on('chatMessage', (data) => {
        io.emit('chatMessage', {
            name: data.name,
            msg: data.msg
        });
    });

    // عند خروج/انقطاع اتصال اللاعب
    socket.on('disconnect', () => {
        console.log(`[-] غادر اللاعب السيرفر: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

// تعيين المنفذ البرمجي للسيرفر (يدعم البيئات المحلية وخدمات الاستضافة مثل Render)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل بنجاح على المنفذ: http://localhost:${PORT}`);
});
