const socket = io();

const roomInput = document.getElementById('roomInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const callArea = document.getElementById('callArea');
const roomCodeDisplay = document.getElementById('roomCode');
const callStatus = document.getElementById('callStatus');
const copyBtn = document.getElementById('copyBtn');
const muteBtn = document.getElementById('muteBtn');
const hangupBtn = document.getElementById('hangupBtn');
const message = document.getElementById('message');

let currentRoom = null;
let localStream = null;
let peerConnection = null;
let remoteSocketId = null;
let isMuted = false;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

async function startCall(roomId) {
    if (currentRoom) return;

    try {
        message.textContent = 'Requesting microphone access...';

        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
        });

        currentRoom = roomId;
        roomCodeDisplay.textContent = roomId;
        callArea.classList.add('active');
        callStatus.textContent = 'Waiting for someone to join...';
        message.textContent = '';

        muteBtn.disabled = false;
        hangupBtn.disabled = false;
        muteBtn.textContent = '🎙️ Mute';

        socket.emit('join-room', roomId);
    } catch (error) {
        console.error(error);
        message.textContent = 'Microphone access failed. Check browser permissions.';
        stopCall(false);
    }
}

function createPeerConnection(targetId) {
    remoteSocketId = targetId;

    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: targetId,
                candidate: event.candidate
            });
        }
    };

    peerConnection.ontrack = event => {
        let audio = document.getElementById('remoteAudio');

        if (!audio) {
            audio = document.createElement('audio');
            audio.id = 'remoteAudio';
            audio.autoplay = true;
            document.body.appendChild(audio);
        }

        audio.srcObject = event.streams[0];
        audio.play().catch(console.error);
    };

    peerConnection.onconnectionstatechange = () => {
        if (!peerConnection) return;

        if (peerConnection.connectionState === 'connected') {
            callStatus.textContent = 'Connected! You are now talking.';
        } else if (
            peerConnection.connectionState === 'disconnected' ||
            peerConnection.connectionState === 'failed'
        ) {
            callStatus.textContent = 'Connection lost. Try reconnecting.';
        }
    };

    return peerConnection;
}

async function makeOffer(targetId) {
    const pc = createPeerConnection(targetId);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit('offer', {
        target: targetId,
        offer: pc.localDescription
    });
}

socket.on('room-joined', async data => {
    if (data.peers.length > 0) {
        callStatus.textContent = 'Connecting...';

        try {
            await makeOffer(data.peers[0]);
        } catch (error) {
            console.error(error);
            message.textContent = 'Could not start the connection.';
        }
    }
});

socket.on('user-joined', () => {
    callStatus.textContent = 'Someone joined. Connecting...';
});

socket.on('offer', async data => {
    try {
        const pc = createPeerConnection(data.sender);

        await pc.setRemoteDescription(data.offer);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('answer', {
            target: data.sender,
            answer: pc.localDescription
        });
    } catch (error) {
        console.error(error);
        message.textContent = 'Could not answer the call.';
    }
});

socket.on('answer', async data => {
    if (peerConnection) {
        await peerConnection.setRemoteDescription(data.answer);
    }
});

socket.on('ice-candidate', async data => {
    if (peerConnection && data.candidate) {
        try {
            await peerConnection.addIceCandidate(data.candidate);
        } catch (error) {
            console.error('ICE candidate error:', error);
        }
    }
});

socket.on('user-disconnected', () => {
    callStatus.textContent = 'The other person left the call.';
    closePeerConnection();
});

socket.on('room-error', error => {
    message.textContent = error;
    stopCall(false);
});

function closePeerConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    remoteSocketId = null;

    const audio = document.getElementById('remoteAudio');
    if (audio) audio.remove();
}

function stopCall(notifyServer = true) {
    if (notifyServer && currentRoom) {
        socket.emit('leave-room', currentRoom);
    }

    closePeerConnection();

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    currentRoom = null;
    isMuted = false;

    callArea.classList.remove('active');
    muteBtn.disabled = true;
    hangupBtn.disabled = true;
    muteBtn.textContent = '🎙️ Mute';
    callStatus.textContent = 'Call ended.';
}

createBtn.addEventListener('click', () => {
    const room = Math.random().toString(36).substring(2, 8).toUpperCase();
    startCall(room);
});

joinBtn.addEventListener('click', () => {
    const room = roomInput.value.trim().toUpperCase();

    if (!room) {
        message.textContent = 'Please enter a room code.';
        return;
    }

    startCall(room);
});

copyBtn.addEventListener('click', async () => {
    if (!currentRoom) return;

    try {
        await navigator.clipboard.writeText(currentRoom);
        copyBtn.textContent = 'Copied!';
    } catch {
        message.textContent = 'Could not copy room code.';
    }
});

muteBtn.addEventListener('click', () => {
    if (!localStream) return;

    isMuted = !isMuted;

    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });

    muteBtn.textContent = isMuted ? '🔇 Unmute' : '🎙️ Mute';
});

hangupBtn.addEventListener('click', () => {
    stopCall();
});

socket.on('connect_error', () => {
    message.textContent = 'Server connection error. Please refresh.';
});