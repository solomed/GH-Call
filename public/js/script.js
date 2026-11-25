
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
let pendingCandidates = [];
let isLeaving = false;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
};

async function startCall(roomId) {
    if (currentRoom || localStream) return;

    try {
        message.textContent = 'Requesting microphone access...';

        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });

        currentRoom = roomId;
        roomCodeDisplay.textContent = roomId;
        callArea.classList.add('active');
        callStatus.textContent = 'Joining room...';
        message.textContent = '';

        muteBtn.disabled = false;
        hangupBtn.disabled = false;

        socket.emit('join-room', roomId);

    } catch (error) {
        console.error('Microphone error:', error);
        message.textContent = 'Microphone access failed. Check permissions.';
        stopCall(false);
    }
}

function createPeerConnection(targetId) {
    if (peerConnection) {
        peerConnection.close();
    }

    remoteSocketId = targetId;
    pendingCandidates = [];

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnection = pc;

    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });

    pc.onicecandidate = event => {
        if (event.candidate && remoteSocketId === targetId) {
            socket.emit('ice-candidate', {
                target: targetId,
                candidate: event.candidate
            });
        }
    };

    pc.ontrack = event => {
        let audio = document.getElementById('remoteAudio');

        if (!audio) {
            audio = document.createElement('audio');
            audio.id = 'remoteAudio';
            audio.autoplay = true;
            audio.playsInline = true;
            document.body.appendChild(audio);
        }

        audio.srcObject = event.streams[0];

        audio.play().catch(error => {
            console.warn('Audio playback needs user interaction:', error);
        });
    };

    pc.oniceconnectionstatechange = () => {
        if (peerConnection !== pc) return;

        console.log('ICE state:', pc.iceConnectionState);

        if (pc.iceConnectionState === 'checking') {
            callStatus.textContent = 'Establishing voice connection...';
        } else if (pc.iceConnectionState === 'connected' ||
                   pc.iceConnectionState === 'completed') {
            callStatus.textContent = 'Connected! You are now talking.';
        } else if (pc.iceConnectionState === 'failed') {
            callStatus.textContent = 'Voice connection failed. A TURN relay may be needed.';
        } else if (pc.iceConnectionState === 'disconnected') {
            callStatus.textContent = 'Connection interrupted. Trying to recover...';
        } else if (pc.iceConnectionState === 'closed') {
            callStatus.textContent = 'Call ended.';
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('Peer state:', pc.connectionState);
    };

    return pc;
}

async function flushPendingCandidates(pc) {
    const candidates = [...pendingCandidates];
    pendingCandidates = [];

    for (const candidate of candidates) {
        if (peerConnection !== pc) return;

        try {
            await pc.addIceCandidate(candidate);
        } catch (error) {
            console.error('Could not add queued ICE candidate:', error);
        }
    }
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
        callStatus.textContent = 'Connecting to the other person...';

        try {
            await makeOffer(data.peers[0]);
        } catch (error) {
            console.error('Offer error:', error);
            message.textContent = 'Could not start the voice connection.';
        }
    } else {
        callStatus.textContent = 'Waiting for someone to join...';
    }
});

socket.on('user-joined', () => {
    callStatus.textContent = 'Someone joined. Connecting...';
});

socket.on('offer', async data => {
    try {
        const pc = createPeerConnection(data.sender);

        await pc.setRemoteDescription(data.offer);
        await flushPendingCandidates(pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('answer', {
            target: data.sender,
            answer: pc.localDescription
        });

    } catch (error) {
        console.error('Answer error:', error);
        message.textContent = 'Could not answer the call.';
    }
});

socket.on('answer', async data => {
    if (!peerConnection) return;

    try {
        await peerConnection.setRemoteDescription(data.answer);
        await flushPendingCandidates(peerConnection);
    } catch (error) {
        console.error('Remote answer error:', error);
    }
});

socket.on('ice-candidate', async data => {
    if (!data.candidate) return;

    if (!peerConnection || !peerConnection.remoteDescription) {
        pendingCandidates.push(data.candidate);
        return;
    }

    try {
        await peerConnection.addIceCandidate(data.candidate);
    } catch (error) {
        console.error('ICE candidate error:', error);
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

socket.on('disconnect', () => {
    if (currentRoom) {
        callStatus.textContent = 'Server connection lost. Reconnecting...';
    }
});

socket.on('connect', () => {
    if (currentRoom && !isLeaving) {
        callStatus.textContent = 'Server reconnected. Please rejoin the room.';
    }
});

socket.on('connect_error', error => {
    console.error('Socket connection error:', error);
    message.textContent = 'Server connection error.';
});

function closePeerConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    remoteSocketId = null;
    pendingCandidates = [];

    const audio = document.getElementById('remoteAudio');
    if (audio) {
        audio.srcObject = null;
        audio.remove();
    }
}

function stopCall(notifyServer = true) {
    isLeaving = true;

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

    setTimeout(() => {
        isLeaving = false;
    }, 500);
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
    } catch (error) {
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