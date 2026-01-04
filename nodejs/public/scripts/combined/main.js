// Combined Page V4 - Vehicle Manager with LocalStorage
(function () {
    'use strict';

    // Elements
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarClose = document.getElementById('sidebarClose');
    const mainCanvas = document.getElementById('mainCanvas');
    const previewCanvas = document.getElementById('previewCanvas');
    const previewFloat = document.getElementById('previewFloat');
    const previewClose = document.getElementById('previewClose');
    const vehicleList = document.getElementById('vehicleList');
    const uploadZone = document.getElementById('uploadZone');
    const vehicleUpload = document.getElementById('vehicleUpload');
    const fpsSlider = document.getElementById('fpsSlider');
    const fpsValue = document.getElementById('fpsValue');
    const sizeSlider = document.getElementById('sizeSlider');
    const sizeValue = document.getElementById('sizeValue');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const connectionStatus = document.getElementById('connectionStatus');
    const framesSent = document.getElementById('framesSent');
    const framesReceived = document.getElementById('framesReceived');
    const detectionCount = document.getElementById('detectionCount');
    const lightStatus = document.getElementById('lightStatus');
    const cameraSelect = document.getElementById('cameraSelect');

    // State
    let socket = null;
    let isCapturing = false;
    let captureInterval = null;
    let sentFrames = 0;
    let receivedFrames = 0;
    let currentLight = 'red';
    let vehicleX = 50;
    let vehicleY = 70;
    let vehicleSize = 150;
    let lightSize = 100; // Traffic light size percentage
    let selectedCameraId = null;
    let latestPreviewImage = null;
    let latestVehicleData = null;
    let latestTrafficSignData = null; // New: Store traffic sign data
    let latestTrackLineY = null;
    let lastManualLightChange = 0; // Debounce manual changes

    // HLS State
    let hls = null;
    let videoElement = null;

    // Camera Configs
    let allCameras = [];
    let currentCameraConfig = null;

    // Capture Source Config
    let captureSource = 'simulation'; // 'simulation', 'webcam', or 'video'
    let webcamStream = null;
    const webcamVideo = document.getElementById('webcamVideo');
    const loopVideo = document.getElementById('loopVideo');
    const sourceSelect = document.getElementById('sourceSelect');
    const videoFileGroup = document.getElementById('videoFileGroup');
    const videoFileInput = document.getElementById('videoFileInput');

    // Color map helper
    const colorMap = new Map();
    function getColorForClass(className) {
        if (!colorMap.has(className)) {
            let hash = 0;
            for (let i = 0; i < className.length; i++) {
                hash = className.charCodeAt(i) + ((hash << 5) - hash);
            }
            const r = hash & 0xff;
            const g = (hash >> 8) & 0xff;
            const b = (hash >> 16) & 0xff;
            colorMap.set(className, { r, g, b });
        }
        return colorMap.get(className);
    }

    // Vehicle Manager
    let vehicles = [];
    let activeVehicleIndex = 0;
    const STORAGE_KEY = 'traffic_demo_vehicles';

    // Default vehicles - use local image to avoid CORS
    const DEFAULT_VEHICLES = [
        { name: 'Xe demo', url: '/public/images/xe-demo.webp' }
    ];

    init();

    function init() {
        setupCanvas();
        setupSidebar();
        setupVehicleManager();
        setupTrafficLights();
        setupSensorSimulation();
        setupCaptureSource(); // New
        setupCapture();
        setupPreview();
        setupKeyboard();
        loadCameras();
        // connectSocket(); // Removed


        window.addEventListener('resize', () => { setupCanvas(); });
        requestAnimationFrame(renderLoop);
    }

    function setupCanvas() {
        mainCanvas.width = window.innerWidth;
        mainCanvas.height = window.innerHeight;
        previewCanvas.width = 280;
        previewCanvas.height = 160;
    }

    function setupSidebar() {
        sidebarToggle.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
        sidebarClose.addEventListener('click', () => document.body.classList.remove('sidebar-open'));
    }

    // Vehicle Manager
    function setupVehicleManager() {
        loadVehicles();
        renderVehicleList();

        // Upload
        uploadZone.addEventListener('click', () => vehicleUpload.click());
        uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) addVehicle(e.dataTransfer.files[0]);
        });
        vehicleUpload.addEventListener('change', (e) => {
            if (e.target.files[0]) addVehicle(e.target.files[0]);
        });

        // Size
        sizeSlider.addEventListener('input', (e) => {
            vehicleSize = parseInt(e.target.value);
            sizeValue.textContent = vehicleSize;
        });
    }

    function loadVehicles() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            vehicles = JSON.parse(saved);
        }

        // Add defaults if empty
        if (vehicles.length === 0) {
            DEFAULT_VEHICLES.forEach((v, i) => {
                loadImageAsDataURL(v.url, (dataURL) => {
                    if (dataURL) {
                        vehicles.push({ name: v.name, dataURL: dataURL });
                        saveVehicles();
                        renderVehicleList();
                    }
                });
            });

            // Also add fallback immediately
            vehicles.push({ name: 'Xe mặc định', dataURL: createFallbackVehicle() });
            saveVehicles();
        }
    }

    function loadImageAsDataURL(url, callback) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                callback(canvas.toDataURL('image/jpeg', 0.8));
            } catch (e) {
                callback(null);
            }
        };
        img.onerror = () => callback(null);
        img.src = url;
    }

    function createFallbackVehicle() {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');

        // Body
        ctx.fillStyle = '#1565c0';
        ctx.fillRect(10, 30, 180, 50);

        // Top
        ctx.fillStyle = '#1976d2';
        ctx.beginPath();
        ctx.moveTo(40, 30);
        ctx.lineTo(60, 10);
        ctx.lineTo(140, 10);
        ctx.lineTo(160, 30);
        ctx.closePath();
        ctx.fill();

        // Windows
        ctx.fillStyle = '#90caf9';
        ctx.fillRect(65, 14, 30, 14);
        ctx.fillRect(105, 14, 30, 14);

        // Wheels
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(50, 80, 15, 0, Math.PI * 2);
        ctx.arc(150, 80, 15, 0, Math.PI * 2);
        ctx.fill();

        // Plate
        ctx.fillStyle = '#fff';
        ctx.fillRect(75, 60, 50, 15);
        ctx.fillStyle = '#000';
        ctx.font = 'bold 10px Arial';
        ctx.fillText('30E-123', 78, 72);

        return canvas.toDataURL('image/png');
    }

    function saveVehicles() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicles));
    }

    function renderVehicleList() {
        vehicleList.innerHTML = '';
        vehicles.forEach((v, i) => {
            const item = document.createElement('div');
            item.className = 'vehicle-item' + (i === activeVehicleIndex ? ' active' : '');
            item.innerHTML = `
        <img src="${v.dataURL}" alt="${v.name}" />
        <button class="delete-btn" data-index="${i}"><i class="fas fa-times"></i></button>
      `;
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.delete-btn')) {
                    activeVehicleIndex = i;
                    renderVehicleList();
                }
            });
            vehicleList.appendChild(item);
        });

        // Delete handlers
        vehicleList.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                vehicles.splice(idx, 1);
                if (activeVehicleIndex >= vehicles.length) activeVehicleIndex = Math.max(0, vehicles.length - 1);
                saveVehicles();
                renderVehicleList();
            });
        });
    }

    function addVehicle(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            vehicles.push({ name: file.name, dataURL: e.target.result });
            activeVehicleIndex = vehicles.length - 1;
            saveVehicles();
            renderVehicleList();
        };
        reader.readAsDataURL(file);
    }

    function getActiveVehicle() {
        return vehicles[activeVehicleIndex] || null;
    }

    // Keyboard
    function setupKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;
            const step = 2;
            switch (e.key.toLowerCase()) {
                case 'w': vehicleY = Math.max(10, vehicleY - step); break;
                case 's': vehicleY = Math.min(90, vehicleY + step); break;
                case 'a': vehicleX = Math.max(10, vehicleX - step); break;
                case 'd': vehicleX = Math.min(90, vehicleX + step); break;
                default: return;
            }
            e.preventDefault();
        });
    }

    // Traffic Lights
    function setupTrafficLights() {
        document.querySelectorAll('.light-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.light;
                setLight(color);
                lastManualLightChange = Date.now();
                emitTrafficLight(color);
            });
        });

        // Light size slider
        const lightSizeSlider = document.getElementById('lightSizeSlider');
        const lightSizeValue = document.getElementById('lightSizeValue');
        if (lightSizeSlider) {
            lightSizeSlider.addEventListener('input', (e) => {
                lightSize = parseInt(e.target.value);
                lightSizeValue.textContent = lightSize;
            });
        }

        // Click on traffic light display to cycle colors
        const trafficLight = document.getElementById('trafficLight');
        if (trafficLight) {
            trafficLight.style.cursor = 'pointer';
            trafficLight.addEventListener('click', () => {
                const colors = ['red', 'yellow', 'green'];
                const currentIndex = colors.indexOf(currentLight);
                const nextColor = colors[(currentIndex + 1) % 3];
                setLight(nextColor);
                lastManualLightChange = Date.now();
                emitTrafficLight(nextColor);
            });
        }
    }

    function emitTrafficLight(color) {
        // Disabled per user request (manual changes should not notify server)
        return;

        /*
        if (!socket || !selectedCameraId) return;
        socket.emit('traffic_light', {
            cameraId: selectedCameraId,
            traffic_status: color,
            detections: [],
            inference_time: 0,
            image_dimensions: { width: mainCanvas.width || 640, height: mainCanvas.height || 480 },
            created_at: Date.now()
        });
        */
    }

    function setLight(color) {
        currentLight = color;
        document.querySelectorAll('.tl-light').forEach(l => l.classList.remove('active'));
        document.querySelector(`.tl-light.${color}`).classList.add('active');
        document.querySelectorAll('.light-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.light-btn.${color}`).classList.add('active');
        lightStatus.textContent = { red: '🔴 Đèn đỏ', yellow: '🟡 Đèn vàng', green: '🟢 Đèn xanh' }[color];
    }

    // Render
    function renderLoop() {
        render();
        drawPreviewScene(); // Continuous preview rendering
        requestAnimationFrame(renderLoop);
    }

    function render() {
        const ctx = mainCanvas.getContext('2d');
        const w = mainCanvas.width;
        const h = mainCanvas.height;

        // --- WEBCAM MODE ---
        if (captureSource === 'webcam') {
            if (webcamVideo && webcamVideo.readyState === 4) {
                const videoRatio = webcamVideo.videoWidth / webcamVideo.videoHeight;
                const canvasRatio = w / h;
                let dw, dh, dx, dy;
                if (canvasRatio > videoRatio) {
                    dw = w; dh = w / videoRatio; dx = 0; dy = (h - dh) / 2;
                } else {
                    dh = h; dw = h * videoRatio; dy = 0; dx = (w - dw) / 2;
                }
                ctx.drawImage(webcamVideo, dx, dy, dw, dh);
            } else {
                ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = "#fff"; ctx.font = "20px Arial"; ctx.textAlign = "center";
                ctx.fillText("Đang chờ Camera...", w / 2, h / 2);
            }
            return; // Stop here for webcam
        }

        // --- SIMULATION MODE ---
        // Road
        ctx.fillStyle = '#2d3436';
        ctx.fillRect(0, 0, w, h);

        // Lane lines
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 6;
        ctx.setLineDash([40, 30]);

        // Get Lane Config
        let dividers = [25, 50, 75]; // Default
        let vehiclesCfg = [];

        if (currentCameraConfig) {
            dividers = (currentCameraConfig.camera_lane_track_point || []).sort((a, b) => a - b);
            vehiclesCfg = currentCameraConfig.camera_lane_vehicles || [];
        }

        // Draw dividers
        dividers.forEach(pos => {
            const x = w * (pos / 100);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        });
        ctx.setLineDash([]);

        // Draw Lane Labels
        const boundaries = [0, ...dividers, 100];
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        for (let i = 0; i < boundaries.length - 1; i++) {
            const start = boundaries[i];
            const end = boundaries[i + 1];
            const cx = w * ((start + end) / 200);

            let label = "ANY";
            if (currentCameraConfig) {
                const types = vehiclesCfg[i];
                if (Array.isArray(types)) label = types.join(', ');
                else if (types) label = String(types);
            }
            label = label.toUpperCase();

            ctx.fillStyle = "rgba(0,0,0,0.5)";
            const tw = ctx.measureText(label).width + 20;
            ctx.fillRect(cx - tw / 2, 10, tw, 34);

            ctx.fillStyle = "#fff";
            ctx.fillText(label, cx, 15);
        }

        // Stop line
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, h * 0.25, w, 8);
        ctx.fillStyle = '#00ffff';
        ctx.font = 'bold 14px Inter, Arial';
        ctx.fillText('Counting Line', 10, h * 0.25 - 5);

        // Traffic light (with size control)
        const tlScale = lightSize / 100;
        const tlWidth = 40 * tlScale;
        const tlHeight = 95 * tlScale;
        const tlRadius = 10 * tlScale;
        const tlGap = 28 * tlScale;
        const tlColors = { red: '#ff0000', yellow: '#ffcc00', green: '#00ff00' };

        ctx.fillStyle = '#222';
        ctx.fillRect(w - 15 - tlWidth, 15, tlWidth, tlHeight);
        ['red', 'yellow', 'green'].forEach((c, i) => {
            ctx.beginPath();
            ctx.arc(w - 15 - tlWidth / 2, 15 + tlRadius + 5 * tlScale + i * tlGap, tlRadius, 0, Math.PI * 2);
            ctx.fillStyle = c === currentLight ? tlColors[c] : '#333';
            ctx.fill();
        });

        // Vehicle
        const v = getActiveVehicle();
        if (v) {
            const img = new Image();
            img.src = v.dataURL;
            if (img.complete && img.naturalWidth > 0) {
                const vx = vehicleX / 100 * w - vehicleSize / 2;
                const vy = vehicleY / 100 * h - vehicleSize / 2;
                const aspect = img.naturalHeight / img.naturalWidth;
                ctx.drawImage(img, vx, vy, vehicleSize, vehicleSize * aspect);
            }
        }
    }

    // Capture
    function setupCapture() {
        fpsSlider.addEventListener('input', (e) => fpsValue.textContent = e.target.value);
        startBtn.addEventListener('click', startCapture);
        stopBtn.addEventListener('click', stopCapture);
    }

    function setupCaptureSource() {
        if (!sourceSelect) return;

        // Handle video file selection
        if (videoFileInput) {
            videoFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file && loopVideo) {
                    const url = URL.createObjectURL(file);
                    loopVideo.src = url;
                    loopVideo.load();
                    loopVideo.play().catch(err => console.log('Video autoplay blocked:', err));
                }
            });
        }

        sourceSelect.addEventListener('change', async (e) => {
            captureSource = e.target.value;

            // Show/hide video file input
            if (videoFileGroup) {
                videoFileGroup.style.display = captureSource === 'video' ? 'block' : 'none';
            }

            if (captureSource === 'webcam') {
                // Stop loop video if playing
                if (loopVideo) {
                    loopVideo.pause();
                    loopVideo.src = '';
                }
                try {
                    // Use getDisplayMedia for screen recording instead of webcam
                    webcamStream = await navigator.mediaDevices.getDisplayMedia({
                        video: {
                            cursor: "always",
                            displaySurface: "monitor" // Prefer full screen capture
                        },
                        audio: false
                    });
                    webcamVideo.srcObject = webcamStream;
                    webcamVideo.play();

                    // Handle user stopping screen share via browser UI
                    webcamStream.getVideoTracks()[0].onended = () => {
                        sourceSelect.value = 'simulation';
                        captureSource = 'simulation';
                        webcamVideo.srcObject = null;
                    };
                } catch (err) {
                    console.error("Screen capture error:", err);
                    alert("Không thể ghi màn hình: " + err.message);
                    sourceSelect.value = 'simulation';
                    captureSource = 'simulation';
                }
            } else if (captureSource === 'video') {
                // Stop webcam stream
                if (webcamStream) {
                    webcamStream.getTracks().forEach(track => track.stop());
                    webcamStream = null;
                }
                webcamVideo.srcObject = null;
                // Loop video will be started when file is selected
            } else {
                // Simulation mode - stop all other sources
                if (webcamStream) {
                    webcamStream.getTracks().forEach(track => track.stop());
                    webcamStream = null;
                }
                webcamVideo.srcObject = null;
                if (loopVideo) {
                    loopVideo.pause();
                    loopVideo.src = '';
                }
            }
        });
    }

    function startCapture() {
        if (!ws || ws.readyState !== WebSocket.OPEN) { alert('Chưa kết nối server WebSocket!'); return; }
        if (!selectedCameraId) { alert('Chọn camera trước!'); return; }

        isCapturing = true;
        document.body.classList.add('recording');
        startBtn.disabled = true;
        stopBtn.disabled = false;
        captureInterval = setInterval(captureAndSend, 1000 / parseInt(fpsSlider.value));
    }

    function stopCapture() {
        isCapturing = false;
        document.body.classList.remove('recording');
        startBtn.disabled = false;
        stopBtn.disabled = true;
        if (captureInterval) clearInterval(captureInterval);
    }

    const sendCanvas = document.createElement('canvas');
    sendCanvas.width = 640;
    sendCanvas.height = 480;

    function captureAndSend() {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const sCtx = sendCanvas.getContext('2d');

        // Draw from appropriate source
        if (captureSource === 'video' && loopVideo && loopVideo.readyState >= 2) {
            // Draw from loop video
            sCtx.drawImage(loopVideo, 0, 0, 640, 480);
        } else if (captureSource === 'webcam' && webcamVideo && webcamVideo.readyState >= 2) {
            // Draw from webcam/screen capture
            sCtx.drawImage(webcamVideo, 0, 0, 640, 480);
        } else {
            // Draw from simulation canvas
            sCtx.drawImage(mainCanvas, 0, 0, 640, 480);
        }

        const imageData = sendCanvas.toDataURL('image/jpeg', 1.0);
        const buffer = dataURLtoBlob(imageData);

        // Send binary frame directly via WebSocket
        ws.send(buffer);

        sentFrames++;
        framesSent.textContent = sentFrames;
    }

    function dataURLtoBlob(dataURL) {
        const parts = dataURL.split(',');
        const byteString = atob(parts[1]);
        const uint8Array = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) uint8Array[i] = byteString.charCodeAt(i);
        return uint8Array;
    }

    // Preview - Using HLS
    function setupPreview() {
        // Create video element if not exists
        if (!videoElement) {
            videoElement = document.createElement('video');
            videoElement.style.display = 'none'; // Hidden video, draw to canvas
            videoElement.muted = true;
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            document.body.appendChild(videoElement);
        }

        let isDrag = false, ox = 0, oy = 0;
        previewFloat.querySelector('.preview-header').addEventListener('mousedown', (e) => {
            isDrag = true;
            ox = e.clientX - previewFloat.offsetLeft;
            oy = e.clientY - previewFloat.offsetTop;
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDrag) return;
            previewFloat.style.left = (e.clientX - ox) + 'px';
            previewFloat.style.top = (e.clientY - oy) + 'px';
            previewFloat.style.right = 'auto';
            previewFloat.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => isDrag = false);
        previewClose.addEventListener('click', () => previewFloat.style.display = 'none');
    }

    function initFlvPlayer(cameraId) {
        if (!videoElement) setupPreview(); // Ensure video element exists

        if (window.flvPlayer) {
            window.flvPlayer.destroy();
            window.flvPlayer = null;
        }

        // HTTP-FLV Protocol (Port 8000)
        // Dynamic stream path based on Camera ID
        const streamUrl = `${window.location.protocol}//${window.location.hostname}:8000/live/${cameraId}.flv`;

        if (flvjs.isSupported()) {
            const player = flvjs.createPlayer({
                type: 'flv',
                url: streamUrl,
                isLive: true,
                cors: true,
                hasAudio: false
            });
            player.attachMediaElement(videoElement);
            player.load();
            player.play().catch(e => console.log('Autoplay blocked:', e));
            window.flvPlayer = player;
        } else {
            console.error("FLV not supported on this browser");
        }
    }

    // Socket
    // WebSocket for Image Upload
    let ws;

    function connectDataWebSocket(cameraId) {
        if (ws) ws.close();
        if (!cameraId) return;

        // Find camera key
        const cam = allCameras.find(c => c._id === cameraId);
        const apiKey = cam ? cam.camera_api_key : 'default_key'; // Fallback or handle error

        // Assuming WS server on port 3000 (default env)
        // You might need to expose WS port to frontend via API or env
        const wsPort = 3000;
        const wsUrl = `ws://${window.location.hostname}:${wsPort}?cameraId=${cameraId}&apiKey=${apiKey}`;

        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
            console.log('WS Image Upload Connected');
            connectionStatus.className = 'status-badge connected';
            connectionStatus.innerHTML = '<span class="status-dot"></span> Đã kết nối WS';
        };
        ws.onerror = (err) => console.error('WS Error:', err);
    }

    // Legacy Socket.IO removed as requested
    // Auto start
    // init(); // Removed duplicate call


    function loadCameras() {
        fetch('/api/camera/all')
            .then(r => r.json())
            .then(data => {
                allCameras = data.metadata || [];
                const cameras = allCameras;
                cameraSelect.innerHTML = '<option value="">Chọn camera...</option>';
                cameras.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c._id;
                    opt.textContent = c.camera_name || c._id;
                    cameraSelect.appendChild(opt);
                });
                if (cameras.length > 0) {
                    selectCamera(cameras[0]._id);
                }
            });
        cameraSelect.addEventListener('change', (e) => selectCamera(e.target.value));
    }

    function selectCamera(cameraId) {
        if (selectedCameraId && socket) {
            socket.emit('leave_camera', selectedCameraId);
        }
        selectedCameraId = cameraId;
        cameraSelect.value = cameraId;

        // Find config
        currentCameraConfig = allCameras.find(c => c._id === cameraId) || null;

        latestVehicleData = null; // Clear old data
        latestTrafficSignData = null; // Clear traffic data
        if (cameraId) {
            // Connect WS for data upload
            connectDataWebSocket(cameraId);
            // Init FLV Player
            initFlvPlayer(cameraId);
        }
    }

    // Preview rendering (Matches preview/main.js logic)
    function drawPreviewScene() {
        try {
            const ctx = previewCanvas.getContext('2d');

            // Draw video frame if available
            if (videoElement && videoElement.readyState >= 2) {
                // Ensure canvas has size (fix for 0x0 canvas issue)
                if (previewCanvas.width === 0 || previewCanvas.height === 0) {
                    const container = previewFloat.querySelector('.preview-content');
                    if (container && container.clientWidth > 0) {
                        previewCanvas.width = container.clientWidth;
                        previewCanvas.height = container.clientWidth * 0.6;
                    }
                }

                ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

                // Calculate aspect ratio
                const imageAspect = videoElement.videoWidth / videoElement.videoHeight;
                const canvasAspect = previewCanvas.width / previewCanvas.height;

                let drawWidth, drawHeight, offsetX, offsetY;

                if (imageAspect > canvasAspect) {
                    drawWidth = previewCanvas.width;
                    drawHeight = previewCanvas.width / imageAspect;
                    offsetX = 0;
                    offsetY = (previewCanvas.height - drawHeight) / 2;
                } else {
                    drawHeight = previewCanvas.height;
                    drawWidth = previewCanvas.height * imageAspect;
                    offsetX = (previewCanvas.width - drawWidth) / 2;
                    offsetY = 0;
                }

                // Draw video frame
                ctx.drawImage(videoElement, offsetX, offsetY, drawWidth, drawHeight);

                // --- Draw Lane Lines & Allow Vehicles ---
                if (currentCameraConfig) {
                    const lanePoints = currentCameraConfig.camera_lane_track_point || [];
                    const laneVehicles = currentCameraConfig.camera_lane_vehicles || [];
                    const sortedPoints = [...lanePoints].sort((a, b) => a - b);

                    // Draw vertical lines
                    ctx.beginPath();
                    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
                    ctx.lineWidth = 2;
                    ctx.setLineDash([10, 10]);

                    sortedPoints.forEach(p => {
                        // Assume p is 0-100 percentage
                        const x = offsetX + (p / 100) * drawWidth;
                        ctx.moveTo(x, offsetY);
                        ctx.lineTo(x, offsetY + drawHeight);
                    });
                    ctx.stroke();
                    ctx.setLineDash([]);


                    // Draw vehicle types per lane
                    const boundaries = [0, ...sortedPoints, 100];
                    ctx.font = "bold 12px Arial";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";

                    for (let i = 0; i < boundaries.length - 1; i++) {
                        const startP = boundaries[i];
                        const endP = boundaries[i + 1];
                        // Config might have fewer lane defs than calculated lanes? Handle gracefully
                        const types = laneVehicles[i] || ["ANY"];

                        const startX = offsetX + (startP / 100) * drawWidth;
                        const endX = offsetX + (endP / 100) * drawWidth;
                        const centerX = (startX + endX) / 2;
                        let text = "ANY";
                        if (Array.isArray(types)) {
                            text = types.join(", ").toUpperCase();
                        } else {
                            text = String(types).toUpperCase();
                        }

                        const p = 6;
                        const tw = ctx.measureText(text).width + p * 2;

                        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
                        ctx.fillRect(centerX - tw / 2, offsetY + 5, tw, 20);

                        ctx.fillStyle = "#fff";
                        ctx.fillText(text, centerX, offsetY + 8);
                    }
                    ctx.textAlign = "left"; // Restore default
                }

                // --- 1. Draw Traffic Signs (from traffic_light event) ---
                if (latestTrafficSignData && latestTrafficSignData.detections) {
                    latestTrafficSignData.detections.forEach((detection) => {
                        const bbox = detection.bbox;
                        const className = detection.class;
                        const confidence = detection.confidence;

                        // Get color
                        const color = getColorForClass(className);
                        const colorString = `rgb(${color.r}, ${color.g}, ${color.b})`;

                        const x1 = offsetX + bbox.x1 * drawWidth;
                        const y1 = offsetY + bbox.y1 * drawHeight;
                        const w = (bbox.x2 - bbox.x1) * drawWidth;
                        const h = (bbox.y2 - bbox.y1) * drawHeight;

                        ctx.strokeStyle = colorString;
                        ctx.lineWidth = 2;
                        ctx.strokeRect(x1, y1, w, h);

                        // Label
                        const label = `${className}: ${confidence.toFixed(2)}`;
                        ctx.font = "14px Arial";
                        const labelWidth = ctx.measureText(label).width + 10;
                        const labelHeight = 20;

                        ctx.fillStyle = colorString;
                        ctx.fillRect(x1, y1 - labelHeight, labelWidth, labelHeight);

                        // Text color
                        const brightness = (color.r * 0.299 + color.g * 0.587 + color.b * 0.114) / 255;
                        ctx.fillStyle = brightness > 0.5 ? "black" : "white";
                        ctx.fillText(label, x1 + 5, y1 - 5);
                    });
                }

                // --- 2. Vehicle Overlays ---
                if (latestVehicleData || latestTrackLineY !== null) {

                    // (Counting Line drawing removed)


                    // Draw tracks
                    if (latestVehicleData && latestVehicleData.tracks && latestVehicleData.tracks.length > 0) {
                        // Determine dimensions for normalization
                        const imgW = latestVehicleData.image_dimensions ? latestVehicleData.image_dimensions.width : (latestPreviewImage ? latestPreviewImage.width : 1280);
                        const imgH = latestVehicleData.image_dimensions ? latestVehicleData.image_dimensions.height : (latestPreviewImage ? latestPreviewImage.height : 720);

                        latestVehicleData.tracks.forEach((track) => {
                            if (track.positions && track.positions.length >= 2) {
                                let color = "rgba(255, 255, 0, 0.8)"; // Default
                                switch (track.class) {
                                    case "car": color = "rgba(0, 255, 0, 0.8)"; break;
                                    case "truck": color = "rgba(0, 0, 255, 0.8)"; break;
                                    case "bus": color = "rgba(255, 0, 0, 0.8)"; break;
                                    case "motorcycle": color = "rgba(255, 255, 0, 0.8)"; break;
                                    case "bicycle": color = "rgba(255, 0, 255, 0.8)"; break;
                                }

                                ctx.beginPath();
                                ctx.strokeStyle = color;
                                ctx.lineWidth = 2;

                                // Sort positions
                                const sortedPositions = [...track.positions].sort((a, b) => a.time - b.time);

                                for (let i = 0; i < sortedPositions.length - 1; i++) {
                                    const pos1 = sortedPositions[i];
                                    const pos2 = sortedPositions[i + 1];

                                    // Use safe dimensions
                                    const x1 = offsetX + (pos1.x / imgW) * drawWidth;
                                    const y1 = offsetY + (pos1.y / imgH) * drawHeight;
                                    const x2 = offsetX + (pos2.x / imgW) * drawWidth;
                                    const y2 = offsetY + (pos2.y / imgH) * drawHeight;

                                    if (i === 0) ctx.moveTo(x1, y1);
                                    ctx.lineTo(x2, y2);
                                }
                                ctx.stroke();
                            }
                        });
                    }

                    // Draw detections
                    if (latestVehicleData && latestVehicleData.detections) {
                        latestVehicleData.detections.forEach((detection) => {
                            const bbox = detection.bbox;
                            if (!bbox) return;

                            const className = detection.class;
                            const confidence = detection.confidence;
                            const trackId = detection.track_id;

                            // Choose color
                            let colorString;
                            switch (className) {
                                case "car": colorString = "rgb(0, 255, 0)"; break; // Green
                                case "truck": colorString = "rgb(0, 0, 255)"; break; // Blue
                                case "bus": colorString = "rgb(255, 0, 0)"; break; // Red
                                case "motorcycle": colorString = "rgb(255, 255, 0)"; break; // Yellow
                                case "bicycle": colorString = "rgb(255, 0, 255)"; break; // Purple
                                default: colorString = "rgb(0, 255, 0)";
                            }

                            const x1 = offsetX + bbox.x1 * drawWidth;
                            const y1 = offsetY + bbox.y1 * drawHeight;
                            const x2 = offsetX + bbox.x2 * drawWidth;
                            const y2 = offsetY + bbox.y2 * drawHeight;
                            const boxWidth = x2 - x1;
                            const boxHeight = y2 - y1;

                            ctx.strokeStyle = colorString;
                            ctx.lineWidth = 2;
                            ctx.strokeRect(x1, y1, boxWidth, boxHeight);

                            let label = `${className}: ${confidence ? confidence.toFixed(2) : '?'}`;
                            if (trackId !== undefined) {
                                label += ` ID:${trackId}`;
                            }

                            ctx.font = "14px Arial";
                            const labelWidth = ctx.measureText(label).width + 10;
                            const labelHeight = 20;

                            ctx.fillStyle = colorString;
                            ctx.fillRect(x1, y1 - labelHeight, labelWidth, labelHeight);

                            let textColor;
                            switch (className) {
                                case "car":
                                case "motorcycle":
                                    textColor = "black";
                                    break;
                                default:
                                    textColor = "white";
                            }

                            ctx.fillStyle = textColor;
                            ctx.fillText(label, x1 + 5, y1 - 5);
                        });
                    }
                }
            }
        } catch (e) {
            console.error('Preview draw error:', e);
        }
    }

    // Handle preview resize
    function setupPreviewResize() {
        const resizeHandle = previewFloat;
        let isResizing = false;

        previewFloat.style.resize = 'both';
        previewFloat.style.overflow = 'hidden';
        previewFloat.style.minWidth = '200px';
        previewFloat.style.minHeight = '150px';

        // Update canvas when container resizes
        const resizeObserver = new ResizeObserver(() => {
            const container = previewFloat.querySelector('.preview-content');
            if (container) {
                previewCanvas.width = container.clientWidth;
                previewCanvas.height = container.clientWidth * 0.6; // 5:3 aspect
                drawPreviewScene();
            }
        });
        resizeObserver.observe(previewFloat);
    }

    // Call resize setup
    setupPreviewResize();

    function setupSensorSimulation() {
        const tempSlider = document.getElementById('tempSlider');
        const humSlider = document.getElementById('humSlider');
        const tempValue = document.getElementById('tempValue');
        const humValue = document.getElementById('humValue');
        const sendBtn = document.getElementById('sendSensorBtn');

        if (tempSlider) {
            tempSlider.addEventListener('input', (e) => tempValue.textContent = e.target.value);
            humSlider.addEventListener('input', (e) => humValue.textContent = e.target.value);
        }

        // Generate toggle state
        let autoGenerateEnabled = false;
        const generateToggle = document.getElementById('generateToggle');

        if (generateToggle) {
            generateToggle.addEventListener('change', () => {
                autoGenerateEnabled = generateToggle.checked;
                console.log("[GENERATE] Auto-generate:", autoGenerateEnabled ? "ON" : "OFF");
            });
        }

        // Helper function to generate realistic data
        function generateRealisticData() {
            const hour = new Date().getHours();
            let baseTemp = hour >= 6 && hour <= 18 ? 28 : 22;
            const temp = baseTemp + (Math.random() - 0.5) * 10;
            let baseHum = (hour >= 5 && hour <= 10) || hour >= 20 ? 70 : 50;
            const hum = baseHum + (Math.random() - 0.5) * 20;

            const finalTemp = Math.round(Math.min(50, Math.max(0, temp)));
            const finalHum = Math.round(Math.min(100, Math.max(0, hum)));

            // Update UI
            if (tempSlider) {
                tempSlider.value = finalTemp;
                tempValue.textContent = finalTemp;
            }
            if (humSlider) {
                humSlider.value = finalHum;
                humValue.textContent = finalHum;
            }
            return { temperature: finalTemp, humidity: finalHum };
        }

        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                // Check if camera selected
                if (!selectedCameraId) {
                    alert("Vui lòng chọn camera trước!");
                    return;
                }

                const data = {
                    camera_id: selectedCameraId,
                    temperature: parseFloat(tempSlider.value),
                    humidity: parseFloat(humSlider.value),
                    created_at: Date.now()
                };

                console.log("[DEBUG SENSOR] Preparing to send:", data);
                console.log("[DEBUG SENSOR] Temperature:", data.temperature, "°C");
                console.log("[DEBUG SENSOR] Humidity:", data.humidity, "%");
                console.log("[DEBUG SENSOR] Camera ID:", data.camera_id);

                // Send via MQTT (using global mqttClient initialized elsewhere)
                if (window.mqttClient && window.mqttClient.connected) {
                    const topic = `traffic-manager/sensor/${selectedCameraId}`;
                    console.log("[DEBUG MQTT] Client connected, publishing to:", topic);
                    window.mqttClient.publish(topic, JSON.stringify(data), { qos: 1 }, (err) => {
                        if (err) {
                            console.error("[DEBUG MQTT] Publish error:", err);
                        } else {
                            console.log("[DEBUG MQTT] Published successfully to:", topic);
                            console.log("[DEBUG MQTT] Payload:", JSON.stringify(data));
                        }
                    });
                } else {
                    console.warn("[DEBUG MQTT] Not connected, state:", window.mqttClient?.connected);
                    console.log("[DEBUG MQTT] Attempting to connect...");
                    initMqttClient().then(() => {
                        const topic = `traffic-manager/sensor/${selectedCameraId}`;
                        console.log("[DEBUG MQTT] Connected, now publishing to:", topic);
                        window.mqttClient.publish(topic, JSON.stringify(data), { qos: 1 });
                    }).catch(err => {
                        console.error("[DEBUG MQTT] Connection failed:", err);
                        alert("Không thể kết nối MQTT: " + err.message);
                    });
                }

                // Feedback animation
                const originalText = sendBtn.innerHTML;
                sendBtn.innerHTML = '<i class="fas fa-check"></i> Đã gửi';
                sendBtn.classList.add('btn-success');
                sendBtn.style.backgroundColor = '#2ecc71';

                setTimeout(() => {
                    sendBtn.innerHTML = originalText;
                    sendBtn.classList.remove('btn-success');
                    sendBtn.style.backgroundColor = '#3498db';
                }, 1000);
            });
        }

        // Auto-send sensor data every 1 second
        let autoSendInterval = null;

        function sendSensorData() {
            if (!selectedCameraId) {
                console.warn("[AUTO-SEND] No camera selected, skipping...");
                return;
            }

            let finalTemp, finalHum;

            if (autoGenerateEnabled) {
                // Generate realistic data
                const generated = generateRealisticData();
                finalTemp = generated.temperature;
                finalHum = generated.humidity;
                console.log("[AUTO-SEND] Generated data:", generated);
            } else {
                // Use slider values
                finalTemp = parseFloat(tempSlider?.value || 25);
                finalHum = parseFloat(humSlider?.value || 60);
            }

            const data = {
                camera_id: selectedCameraId,
                temperature: finalTemp,
                humidity: finalHum,
                created_at: Date.now()
            };

            console.log("[AUTO-SEND] Sending:", data);

            if (window.mqttClient && window.mqttClient.connected) {
                const topic = `traffic-manager/sensor/${selectedCameraId}`;
                window.mqttClient.publish(topic, JSON.stringify(data), { qos: 1 });
                console.log("[AUTO-SEND] Published to:", topic);
            } else {
                console.warn("[AUTO-SEND] MQTT not connected");
            }
        }

        function startAutoSend() {
            if (autoSendInterval) return;
            console.log("[AUTO-SEND] Starting auto-send every 1 second...");
            autoSendInterval = setInterval(sendSensorData, 1000);
        }

        function stopAutoSend() {
            if (autoSendInterval) {
                clearInterval(autoSendInterval);
                autoSendInterval = null;
                console.log("[AUTO-SEND] Stopped auto-send");
            }
        }

        // Toggle checkbox handler
        const autoSendCheckbox = document.getElementById('autoSendToggle');

        if (autoSendCheckbox) {
            autoSendCheckbox.addEventListener('change', () => {
                if (autoSendCheckbox.checked) {
                    if (!selectedCameraId) {
                        alert("Vui lòng chọn camera trước!");
                        autoSendCheckbox.checked = false;
                        return;
                    }
                    startAutoSend();
                } else {
                    stopAutoSend();
                }
            });
        }

        // Expose for manual control from console
        window.startAutoSend = startAutoSend;
        window.stopAutoSend = stopAutoSend;
    }

    // MQTT Client Initialization
    async function initMqttClient() {
        return new Promise((resolve, reject) => {
            if (window.mqttClient && window.mqttClient.connected) {
                resolve();
                return;
            }

            // Use mqtt.js via CDN (loaded in HTML)
            if (typeof mqtt === 'undefined') {
                reject(new Error('MQTT library not loaded'));
                return;
            }

            const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
            const options = {
                clientId: 'combined-page-' + Math.random().toString(16).substr(2, 8),
                clean: true,
                reconnectPeriod: 5000
            };

            window.mqttClient = mqtt.connect(brokerUrl, options);

            window.mqttClient.on('connect', () => {
                console.log('[MQTT] Connected to broker');
                resolve();
            });

            window.mqttClient.on('error', (err) => {
                console.error('[MQTT] Error:', err);
                reject(err);
            });

            window.mqttClient.on('close', () => {
                console.log('[MQTT] Connection closed');
            });
        });
    }

    // Initialize MQTT on page load
    document.addEventListener('DOMContentLoaded', () => {
        initMqttClient().catch(err => console.warn('[MQTT] Initial connection failed:', err.message));
    });
})();
