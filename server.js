const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    socket.on('join-room', (roomId) => {
        if (typeof roomId !== 'string' || !/^[A-Z0-9]{1,30}$/.test(roomId)) {
            socket.emit('room-error', 'Invalid room code.');
            return;
        }

        const members = rooms.get(roomId) || [];

        if (members.length >= 2) {
            socket.emit('room-error', 'This room is full.');
            return;
        }

        if (members.includes(socket.id)) return;

        socket.join(roomId);
        rooms.set(roomId, [...members, socket.id]);

        socket.emit('room-joined', {
            roomId,
            peers: members
        });

        socket.to(roomId).emit('user-joined', socket.id);
        console.log(`${socket.id} joined ${roomId}`);
    });

    socket.on('offer', (data) => {
        if (data?.target && data?.offer) {
            socket.to(data.target).emit('offer', {
                offer: data.offer,
                sender: socket.id
            });
        }
    });

    socket.on('answer', (data) => {
        if (data?.target && data?.answer) {
            socket.to(data.target).emit('answer', {
                answer: data.answer,
                sender: socket.id
            });
        }
    });

    socket.on('ice-candidate', (data) => {
        if (data?.target && data?.candidate) {
            socket.to(data.target).emit('ice-candidate', {
                candidate: data.candidate,
                sender: socket.id
            });
        }
    });

    function leaveRoom() {
        for (const [roomId, members] of rooms) {
            if (members.includes(socket.id)) {
                socket.leave(roomId);

                const remaining = members.filter(id => id !== socket.id);

                if (remaining.length) {
                    rooms.set(roomId, remaining);
                    socket.to(roomId).emit('user-disconnected', socket.id);
                } else {
                    rooms.delete(roomId);
                }
            }
        }
    }

    socket.on('leave-room', leaveRoom);

    socket.on('disconnect', () => {
        leaveRoom();
        console.log('Disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`GH Call running at http://localhost:${PORT}`);
});