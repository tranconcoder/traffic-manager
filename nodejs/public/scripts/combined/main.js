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
    let selectedCameraId = null;

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
        setupCapture();
        setupPreview();
        setupKeyboard();
        connectSocket();

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
            btn.addEventListener('click', () => setLight(btn.dataset.light));
        });
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
        requestAnimationFrame(renderLoop);
    }

    function render() {
        const ctx = mainCanvas.getContext('2d');
        const w = mainCanvas.width;
        const h = mainCanvas.height;

        // Road
        ctx.fillStyle = '#2d3436';
        ctx.fillRect(0, 0, w, h);

        // Lane lines
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 6;
        ctx.setLineDash([40, 30]);
        [0.25, 0.5, 0.75].forEach(pos => {
            ctx.beginPath();
            ctx.moveTo(w * pos, 0);
            ctx.lineTo(w * pos, h);
            ctx.stroke();
        });
        ctx.setLineDash([]);

        // Stop line
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, h * 0.25, w, 8);
        ctx.fillStyle = '#00ffff';
        ctx.font = 'bold 14px Inter, Arial';
        ctx.fillText('Counting Line', 10, h * 0.25 - 5);

        // Traffic light
        const tlColors = { red: '#ff0000', yellow: '#ffcc00', green: '#00ff00' };
        ctx.fillStyle = '#222';
        ctx.fillRect(w - 55, 15, 40, 95);
        ['red', 'yellow', 'green'].forEach((c, i) => {
            ctx.beginPath();
            ctx.arc(w - 35, 35 + i * 28, 10, 0, Math.PI * 2);
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

    function startCapture() {
        if (!socket?.connected) { alert('Chưa kết nối server!'); return; }
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

    function captureAndSend() {
        const imageData = mainCanvas.toDataURL('image/jpeg', 0.7);
        const buffer = dataURLtoBlob(imageData);

        socket.emit('image', {
            cameraId: selectedCameraId,
            imageId: Math.random().toString(36).substr(2, 12),
            buffer: buffer,
            width: mainCanvas.width,
            height: mainCanvas.height,
            track_line_y: 25,
            created_at: Date.now()
        });

        sentFrames++;
        framesSent.textContent = sentFrames;

        const pctx = previewCanvas.getContext('2d');
        pctx.drawImage(mainCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
    }

    function dataURLtoBlob(dataURL) {
        const parts = dataURL.split(',');
        const byteString = atob(parts[1]);
        const uint8Array = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) uint8Array[i] = byteString.charCodeAt(i);
        return uint8Array;
    }

    // Preview
    function setupPreview() {
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

    // Socket
    function connectSocket() {
        socket = io(window.location.origin, { transports: ['websocket'], reconnection: true });

        socket.on('connect', () => {
            connectionStatus.className = 'status-badge connected';
            connectionStatus.innerHTML = '<span class="status-dot"></span> Đã kết nối';
            socket.emit('join_all_camera');
            loadCameras();
        });

        socket.on('disconnect', () => {
            connectionStatus.className = 'status-badge disconnected';
            connectionStatus.innerHTML = '<span class="status-dot"></span> Mất kết nối';
        });

        socket.on('car_detected', (data) => {
            receivedFrames++;
            framesReceived.textContent = receivedFrames;
            if (data.detections) {
                detectionCount.textContent = data.detections.length + ' phát hiện';
                drawDetections(data.detections);
            }
        });

        socket.on('traffic_light', (data) => {
            if (data.traffic_status) {
                const s = data.traffic_status.toLowerCase();
                if (s.includes('red')) setLight('red');
                else if (s.includes('yellow')) setLight('yellow');
                else if (s.includes('green')) setLight('green');
            }
        });
    }

    function loadCameras() {
        fetch('/api/camera/all')
            .then(r => r.json())
            .then(data => {
                const cameras = data.metadata || [];
                cameraSelect.innerHTML = '<option value="">Chọn camera...</option>';
                cameras.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c._id;
                    opt.textContent = c.camera_name || c._id;
                    cameraSelect.appendChild(opt);
                });
                if (cameras.length > 0) {
                    cameraSelect.value = cameras[0]._id;
                    selectedCameraId = cameras[0]._id;
                }
            });
        cameraSelect.addEventListener('change', (e) => selectedCameraId = e.target.value);
    }

    function drawDetections(detections) {
        const ctx = previewCanvas.getContext('2d');
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.font = '10px Inter';
        ctx.fillStyle = '#00ff00';

        detections.forEach(d => {
            const x1 = d.bbox.x1 * previewCanvas.width;
            const y1 = d.bbox.y1 * previewCanvas.height;
            const x2 = d.bbox.x2 * previewCanvas.width;
            const y2 = d.bbox.y2 * previewCanvas.height;
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            ctx.fillText(d.class + (d.id ? ` #${d.id}` : ''), x1, y1 - 3);
        });
    }

})();
