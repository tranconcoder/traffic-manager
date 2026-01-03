// Giá trị mặc định có thể được ghi đè bởi người dùng
const DEFAULT_WEBSOCKET_URL = "localhost:3001";
const DEFAULT_API_KEY =
  "0e1f4b7dc39c63e9dbbfbf5afc2e50f9deb625507cada47b203117c82362d1d2";

// DOM Elements
let startBtn,
  stopBtn,
  status,
  video,
  canvas,
  processingCanvas,
  log,
  frameCounter;
let frameRateSelect,
  qualitySelect,
  resolutionSelect,
  fpsModeSelect,
  fpsLimitContainer;
let sourceTypeSelect; // Biến cho việc chọn nguồn ghi hình
let cameraSelect, apiKeyInput, websocketUrlInput, refreshCameraListBtn; // Biến cho các trường nhập kết nối
// Biến cho tab chất lượng video
let bitrateSlider, bitrateValue, bitratePresets, qualityOptions;
let currentBitrate = 1.0; // Mặc định là 1.0 Mbps

// Camera list
let cameras = [];
let selectedCameraId = "";

// WebSocket connection
let socket = null;
let wsUrl = "";
let reconnectAttempts = 0;
let maxReconnectAttempts = Infinity; // Vô hạn số lần thử kết nối lại
let reconnectInterval = 1000; // 1 giây ban đầu
let maxReconnectInterval = 30000; // Tối đa 30 giây
let reconnectTimeoutId = null;
let isConnecting = false;

// Resolution settings
let currentResolution = {
  width: 1920,
  height: 1080,
};

// Recording state
let mediaStream = null;
let isRecording = false;
let wasRecording = false; // Đánh dấu trạng thái ghi hình trước khi mất kết nối
let frameCount = 0;
let fps = 0;
let lastFpsUpdate = Date.now();
let animationFrameId = null;
let frameInterval = null;
let sendingFrame = false;

// Biến để theo dõi trạng thái hiển thị của trang
let isPageVisible = true;
let lastCaptureImage = null;

// Web Worker và các biến liên quan
let captureWorker = null;
let dedicatedWorker = null; // Worker thông thường
let useBackgroundMode = false; // Chế độ nền khi tab bị ẩn
let wakeLock = null; // Biến để giữ màn hình luôn bật
let mediaKeepAlive = null; // Giữ cho media pipeline hoạt động
let hiddenVideo = null; // Video ẩn để giữ cho trình duyệt tiếp tục xử lý media
let noSleepVideo = null; // Video chạy ngầm để ngăn browser throttling

// Các timer ID giữ cho tab hoạt động
let backgroundTimer = null;
let keepAliveTimer = null;

// Cài đặt thử nghiệm để cải thiện hiệu suất
const PERFORMANCE_MODE = {
  NORMAL: "normal", // Hiệu suất bình thường khi tab hiển thị
  BACKGROUND: "background", // Chế độ tối ưu khi tab bị ẩn
  THROTTLED: "throttled", // Chế độ tiết kiệm khi kết nối kém
  HIGH_PERFORMANCE: "high_performance", // Chế độ hiệu suất tối đa bất kể trạng thái tab
};

let currentPerformanceMode = PERFORMANCE_MODE.NORMAL;

// Initialize DOM elements when the page loads
window.addEventListener("load", () => {
  startBtn = document.getElementById("startBtn");
  stopBtn = document.getElementById("stopBtn");
  status = document.getElementById("status");
  video = document.getElementById("preview");
  canvas = document.getElementById("canvas");
  processingCanvas = document.getElementById("processingCanvas");
  log = document.getElementById("log");
  frameCounter = document.getElementById("frameCounter");
  frameRateSelect = document.getElementById("frameRate");
  qualitySelect = document.getElementById("quality");
  resolutionSelect = document.getElementById("resolution");
  fpsModeSelect = document.getElementById("fpsMode");
  fpsLimitContainer = document.getElementById("fpsLimitContainer");
  sourceTypeSelect = document.getElementById("sourceType"); // Khởi tạo biến cho việc chọn nguồn ghi hình

  // Khởi tạo các trường nhập WebSocket
  cameraSelect = document.getElementById("cameraSelect");
  apiKeyInput = document.getElementById("apiKey");
  websocketUrlInput = document.getElementById("websocketUrl");
  refreshCameraListBtn = document.getElementById("refreshCameraList");

  // Tải các giá trị đã lưu trước đó từ localStorage nếu có
  // apiKeyInput.value = DEFAULT_API_KEY;
  websocketUrlInput.value =
    localStorage.getItem("websocketUrl") || DEFAULT_WEBSOCKET_URL;

  // Sự kiện khi chọn camera
  cameraSelect.addEventListener("change", () => {
    selectedCameraId = cameraSelect.value;
    localStorage.setItem("cameraId", selectedCameraId);

    // Tự động lấy API key từ camera đã chọn
    const selectedCamera = getSelectedCamera();
    if (selectedCamera && selectedCamera.camera_api_key) {
      apiKeyInput.value = selectedCamera.camera_api_key;
      localStorage.setItem("apiKey", selectedCamera.camera_api_key);
      addLog(
        `Đã tự động cập nhật API key cho camera: ${getSelectedCameraName()}`
      );
    }

    addLog(`Đã chọn camera: ${getSelectedCameraName()}`);
  });

  // Thêm sự kiện lưu giá trị khi người dùng thay đổi
  apiKeyInput.addEventListener("change", () => {
    localStorage.setItem("apiKey", apiKeyInput.value);
  });
  websocketUrlInput.addEventListener("change", () => {
    localStorage.setItem("websocketUrl", websocketUrlInput.value);
    addLog(`WebSocket URL updated to: ${websocketUrlInput.value}`);
  });

  // Thêm sự kiện cho nút refresh danh sách camera
  refreshCameraListBtn.addEventListener("click", () => {
    loadCameraList();
  });

  // Update FPS control visibility based on mode selection
  fpsModeSelect.addEventListener("change", () => {
    fpsLimitContainer.style.display =
      fpsModeSelect.value === "limited" ? "block" : "none";
  });

  // Update resolution when selection changes
  resolutionSelect.addEventListener("change", () => {
    const [width, height] = resolutionSelect.value.split(",").map(Number);
    currentResolution.width = width;
    currentResolution.height = height;
    addLog(`Resolution set to: ${width}x${height}`);

    // Update resolution info display
    let quality = "HD";
    if (width === 1920) quality = "Full HD";
    else if (width === 640) quality = "SD";
    else if (width === 320) quality = "Low";
    document.getElementById(
      "resolutionInfo"
    ).textContent = `${quality} (${width}x${height})`;
  });

  // Event listeners for buttons
  startBtn.addEventListener("click", startCapture);
  stopBtn.addEventListener("click", stopCapture);

  // Tải danh sách camera
  loadCameraList();

  // Initialize
  addLog("Page loaded. Ready to start capture.");

  // Initialize FPS control visibility
  fpsLimitContainer.style.display =
    fpsModeSelect.value === "limited" ? "block" : "none";

  // Clean up when page unloads
  window.addEventListener("beforeunload", () => {
    if (isRecording) {
      stopCapture();
    }

    if (socket) {
      socket.close();
    }
  });

  // Tạo video chạy ngầm để ngăn chặn browser throttling
  createNoSleepVideo();

  // Khởi tạo các phần tử điều khiển chất lượng video mới
  bitrateSlider = document.getElementById("bitrateSlider");
  bitrateValue = document.getElementById("bitrateValue");
  bitratePresets = document.querySelectorAll(".preset-button");
  qualityOptions = document.querySelectorAll(".quality-option");

  // Kiểm tra xem các phần tử có tồn tại không trước khi thêm sự kiện
  if (bitrateSlider) {
    bitrateSlider.addEventListener("input", updateBitrateDisplay);
    bitrateSlider.addEventListener("change", applyBitrateSettings);
    // Khởi tạo giá trị ban đầu
    updateBitrateDisplay();
  } else {
    console.warn("Không tìm thấy phần tử bitrateSlider");
  }

  // Thiết lập sự kiện cho các preset bitrate
  if (bitratePresets && bitratePresets.length > 0) {
    bitratePresets.forEach((preset) => {
      preset.addEventListener("click", function () {
        // Xóa trạng thái active của tất cả các preset
        bitratePresets.forEach((p) => p.classList.remove("active"));

        // Thêm active vào preset hiện tại
        this.classList.add("active");

        // Cập nhật giá trị bitrate
        const bitrateValue = parseFloat(this.dataset.bitrate);
        if (bitrateSlider) {
          bitrateSlider.value = bitrateValue;

          // Áp dụng cài đặt
          updateBitrateDisplay();
          applyBitrateSettings();
        }
      });
    });
  } else {
    console.warn("Không tìm thấy các phần tử preset-button");
  }

  // Thiết lập sự kiện cho các tùy chọn chất lượng
  if (qualityOptions && qualityOptions.length > 0) {
    qualityOptions.forEach((option) => {
      option.addEventListener("click", function () {
        // Xóa trạng thái selected của tất cả các tùy chọn
        qualityOptions.forEach((o) => o.classList.remove("selected"));

        // Thêm selected vào tùy chọn hiện tại
        this.classList.add("selected");

        // Chọn radio button tương ứng
        const radio = this.querySelector('input[type="radio"]');
        if (radio) {
          radio.checked = true;

          // Cập nhật dropdown chất lượng nếu tồn tại
          if (qualitySelect) {
            qualitySelect.value = radio.value;

            // Áp dụng cài đặt chất lượng
            updateQualitySettings();
          }
        }
      });
    });
  } else {
    console.warn("Không tìm thấy các phần tử quality-option");
  }

  // Thêm sự kiện cho các radio button chất lượng
  const qualityRadios = document.querySelectorAll(
    'input[name="quality-preset"]'
  );
  if (qualityRadios && qualityRadios.length > 0) {
    qualityRadios.forEach((radio) => {
      radio.addEventListener("change", function () {
        const option = this.closest(".quality-option");
        if (option) {
          qualityOptions.forEach((o) => o.classList.remove("selected"));
          option.classList.add("selected");
          updateQualitySettings();
        }
      });
    });
  }

  // ----- TAB SWITCHING FUNCTIONALITY -----
  // Khởi tạo video giả để giữ cho browser luôn xử lý video
  if (window.BrowserKeepAlive) {
    window.BrowserKeepAlive.setupFakeVideo();
  }

  // Tab switching functionality
  const tabs = document.querySelectorAll(".settings-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", function () {
      // Remove active class from all tabs
      tabs.forEach((t) => t.classList.remove("active"));

      // Add active class to clicked tab
      this.classList.add("active");

      // Hide all settings panels
      document.querySelectorAll(".settings").forEach((panel) => {
        panel.style.display = "none";
      });

      // Show the selected panel
      const tabId = this.getAttribute("data-tab");
      document.getElementById(`${tabId}-settings`).style.display = "grid";
    });
  });

  // Clear log functionality
  document.getElementById("clearLog").addEventListener("click", function () {
    document.getElementById("log").innerHTML = "";
  });

  // Update status styling based on connection status
  const originalUpdateStatus = window.updateStatus || function () { };
  window.updateStatus = function (isConnected, message) {
    const statusElement = document.getElementById("status");
    if (isConnected) {
      statusElement.className = "status connected";
    } else {
      statusElement.className = "status disconnected";
    }
    statusElement.querySelector(".status-text").textContent = message;
    if (originalUpdateStatus && typeof originalUpdateStatus === "function") {
      originalUpdateStatus(isConnected, message);
    }
  };
});

// Cập nhật hiển thị bitrate
function updateBitrateDisplay() {
  if (!bitrateSlider || !bitrateValue) return;

  const value = parseFloat(bitrateSlider.value);
  bitrateValue.textContent = value.toFixed(1) + " Mbps";
  currentBitrate = value;

  // Log để debug
  console.log("Bitrate updated:", currentBitrate);
}

// Áp dụng cài đặt bitrate
function applyBitrateSettings() {
  if (!bitrateSlider || !qualitySelect) return;

  addLog(`Đã cập nhật bitrate: ${currentBitrate} Mbps`);

  // Tính toán chất lượng JPEG tương ứng với bitrate
  // Bitrate càng cao thì chất lượng JPEG càng cao
  const quality = 0.3 + (currentBitrate / 2.0) * 0.7; // Giữa 0.3 và 1.0

  // Cập nhật dropdown chất lượng
  qualitySelect.value = quality.toFixed(2);

  // Nếu đang ghi hình, áp dụng ngay lập tức
  if (isRecording && captureWorker) {
    try {
      captureWorker.postMessage({
        command: "updateQuality",
        quality: quality,
      });
    } catch (e) {
      console.error("Lỗi khi cập nhật chất lượng:", e);
    }
  }
}

// Cập nhật cài đặt chất lượng từ tùy chọn radio
function updateQualitySettings() {
  if (
    !qualityOptions ||
    qualityOptions.length === 0 ||
    !bitrateSlider ||
    !bitratePresets
  )
    return;

  const selectedOption = document.querySelector(".quality-option.selected");
  if (selectedOption) {
    const qualityLevel = selectedOption.dataset.quality;
    let recommendedBitrate = 1.0; // Mặc định

    switch (qualityLevel) {
      case "high":
        recommendedBitrate = 1.5;
        break;
      case "medium":
        recommendedBitrate = 1.0;
        break;
      case "low":
        recommendedBitrate = 0.5;
        break;
    }

    // Cập nhật slider bitrate
    bitrateSlider.value = recommendedBitrate;
    updateBitrateDisplay();

    // Cập nhật trạng thái các preset bitrate
    bitratePresets.forEach((preset) => {
      if (parseFloat(preset.dataset.bitrate) === recommendedBitrate) {
        preset.classList.add("active");
      } else {
        preset.classList.remove("active");
      }
    });

    addLog(`Đã áp dụng cài đặt chất lượng: ${qualityLevel}`);
  }
}

// Hàm lấy danh sách camera từ API
async function loadCameraList() {
  try {
    // Hiển thị trạng thái đang tải
    cameraSelect.innerHTML =
      '<option value="" disabled selected>Đang tải danh sách camera...</option>';
    refreshCameraListBtn.classList.add("loading");
    addLog("Đang tải danh sách camera...");

    // Gọi API để lấy danh sách camera
    const response = await fetch("/api/camera/all");

    if (!response.ok) {
      throw new Error(`Không thể lấy danh sách camera: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.metadata || !Array.isArray(data.metadata)) {
      throw new Error("Dữ liệu camera không hợp lệ");
    }

    // Lưu danh sách camera
    cameras = data.metadata;

    // Cập nhật dropdown
    populateCameraDropdown(cameras);

    // Khôi phục camera đã chọn trước đó nếu có
    const savedCameraId = localStorage.getItem("cameraId");
    if (savedCameraId && cameras.some((cam) => cam._id === savedCameraId)) {
      cameraSelect.value = savedCameraId;
      selectedCameraId = savedCameraId;

      // Sử dụng API key của camera đã chọn
      const selectedCamera = getSelectedCamera();
      if (selectedCamera && selectedCamera.camera_api_key) {
        apiKeyInput.value = selectedCamera.camera_api_key;
        localStorage.setItem("apiKey", selectedCamera.camera_api_key);
        addLog(
          `Đã sử dụng API key từ camera đã lưu: ${selectedCamera.camera_name}`
        );
      }
    } else if (cameras.length > 0) {
      // Chọn camera đầu tiên nếu không có camera nào được lưu trước đó
      cameraSelect.value = cameras[0]._id;
      selectedCameraId = cameras[0]._id;
      localStorage.setItem("cameraId", selectedCameraId);

      // Tự động sử dụng API key của camera đầu tiên
      if (cameras[0].camera_api_key) {
        apiKeyInput.value = cameras[0].camera_api_key;
        localStorage.setItem("apiKey", cameras[0].camera_api_key);
        addLog(
          `Đã tự động sử dụng API key từ camera mặc định: ${cameras[0].camera_name}`
        );
      }
    }

    addLog(`Đã tải ${cameras.length} camera`);
  } catch (error) {
    addLog(`Lỗi khi tải danh sách camera: ${error.message}`);
    cameraSelect.innerHTML =
      '<option value="" disabled selected>Không thể tải danh sách camera</option>';
    console.error("Error loading cameras:", error);
  } finally {
    refreshCameraListBtn.classList.remove("loading");
  }
}

// Hàm cập nhật dropdown camera
function populateCameraDropdown(cameraList) {
  if (!cameraSelect) return;

  cameraSelect.innerHTML = "";

  if (!cameraList || cameraList.length === 0) {
    cameraSelect.innerHTML =
      '<option value="" disabled selected>Không có camera nào</option>';
    return;
  }

  cameraList.forEach((camera) => {
    const option = document.createElement("option");
    option.value = camera._id;
    option.textContent = `${camera.camera_name} (${camera.camera_location})`;
    cameraSelect.appendChild(option);
  });
}

// Hàm lấy thông tin camera hiện tại được chọn
function getSelectedCamera() {
  if (!selectedCameraId || cameras.length === 0) return null;
  return cameras.find((camera) => camera._id === selectedCameraId);
}

// Hàm lấy tên camera hiện tại được chọn
function getSelectedCameraName() {
  const camera = getSelectedCamera();
  return camera ? camera.camera_name : "Chưa chọn camera";
}

// Tạo video ngầm để ngăn browser throttling
function createNoSleepVideo() {
  noSleepVideo = document.createElement("video");
  noSleepVideo.setAttribute("loop", "");
  noSleepVideo.setAttribute("playsinline", "");
  noSleepVideo.setAttribute("muted", "");
  noSleepVideo.setAttribute("defaultMuted", "");
  noSleepVideo.setAttribute("autoplay", "");
  noSleepVideo.setAttribute(
    "src",
    "data:video/mp4;base64,AAAAIGZ0eXBtcDQyAAAAAG1wNDJtcDQxaXNvbWF2YzEAAATKbW9vdgAAAGxtdmhkAAAAANLEP5XSxD+VAAB1MAAAdU4AAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAACFpb2RzAAAAABCAgIAQAE////9//w6AgIAEAAAAAQAABDV0cmFrAAAAXHRraGQAAAAH0sQ/ldLEP5UAAAABAAAAAAAAdU4AAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAACFpb2RzAAAAABCAgIAQAE////9//w6AgIAEAAAAAQAABDV0cmFrAAAAXHRraGQAAAAH0sQ/ldLEP5UAAAABAAAAAAAAdU4AAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAIhaWRzbwAAABBAgIAQAE////9//w6AgIAEAAAAAQAABDV0cmFrAAAAXHRraGQAAAAH0sQ/ldLEP5UAAAABAAAAAAAAdU4AAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAIhaWRzbwAAABBAgIAQAE////9//w6AgIAEAAAAAQAABDV0cmFrAAAAXHRraGQAAAAH0sQ/ldLEP5UAAAABAAAAAAAAdU4AAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAIhaWRzb"
  );
  noSleepVideo.style.display = "none";
  document.body.appendChild(noSleepVideo);
}

// Helper function to log messages
function addLog(message) {
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  console.log(`[Log] ${message}`);
}

// Tạo URL WebSocket từ thông tin người dùng nhập
function buildWebSocketUrl() {
  const websocketServer = websocketUrlInput.value || DEFAULT_WEBSOCKET_URL;
  const cameraId = selectedCameraId;
  const apiKey = apiKeyInput.value || DEFAULT_API_KEY;

  if (!cameraId) {
    addLog("Lỗi: Vui lòng chọn camera trước khi kết nối");
    return null;
  }

  return `wss://${websocketServer}?cameraId=${cameraId}&apiKey=${apiKey}`;
}

// Start screen capture
async function startCapture() {
  try {
    // Kiểm tra xem đã chọn camera chưa
    if (!selectedCameraId) {
      addLog("Vui lòng chọn camera trước khi bắt đầu ghi hình");
      return;
    }

    // Cập nhật URL WebSocket dựa trên thông tin người dùng nhập
    wsUrl = buildWebSocketUrl();

    if (!wsUrl) return;

    // Connect to WebSocket if not connected
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (!connectWebSocket()) {
        return;
      }
    }

    // Get selected source type
    const sourceType = sourceTypeSelect.value;
    addLog(`Capture source type: ${sourceType}`);

    // Get screen capture stream based on source type
    const displayMediaOptions = {
      video: {
        cursor: "always",
        frameRate: {
          ideal: 60,
        },
        // Áp dụng các tùy chọn cụ thể dựa trên loại nguồn đã chọn
        displaySurface: sourceType, // 'display', 'window', 'tab'
      },
      audio: false,
      // Sử dụng thuộc tính preferCurrentTab nếu đã chọn ghi tab hiện tại
      preferCurrentTab: sourceType === "tab",
      // Hiển thị thông tin về loại selecetion
      surfaceSwitching: "include",
      selfBrowserSurface: "include",
      systemAudio: "exclude",
    };

    try {
      // Kiểm tra xem navigator.mediaDevices có tồn tại không
      if (!navigator || !navigator.mediaDevices) {
        throw new Error("Trình duyệt không hỗ trợ API truy cập thiết bị media");
      }

      // Kiểm tra xem kết nối có bảo mật không
      if (location.protocol !== "https:" && location.hostname !== "localhost") {
        throw new Error(
          "API truy cập media chỉ hoạt động trên HTTPS hoặc localhost. Vui lòng sử dụng kết nối bảo mật hoặc localhost."
        );
      }

      mediaStream = await navigator.mediaDevices.getDisplayMedia(
        displayMediaOptions
      );
      video.srcObject = mediaStream;

      // Lắng nghe sự kiện khi nguồn media bị dừng (khi người dùng hủy chia sẻ màn hình)
      mediaStream.getVideoTracks()[0].onended = () => {
        addLog("Media stream ended by user");
        stopCapture();
      };

      // Hiển thị thông tin về nguồn ghi hình đã chọn
      const videoTrack = mediaStream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      const surfaceType = settings.displaySurface || "unknown";
      addLog(
        `Đã chọn nguồn ghi hình: ${surfaceType} (${settings.width}x${settings.height})`
      );

      // Update canvas size when metadata is loaded
      video.onloadedmetadata = () => {
        // Set preview canvas to native resolution
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Set processing canvas to selected resolution
        processingCanvas.width = currentResolution.width;
        processingCanvas.height = currentResolution.height;

        addLog(`Native resolution: ${canvas.width}x${canvas.height}`);
        addLog(
          `Streaming at: ${currentResolution.width}x${currentResolution.height}`
        );

        const fpsMode = fpsModeSelect.value;
        if (fpsMode === "unlimited") {
          addLog("Sending frames at maximum speed (no FPS limit)");
        } else {
          const targetFps = parseInt(frameRateSelect.value, 10);
          addLog(`FPS limited to: ${targetFps}`);
        }

        // Kích hoạt chế độ hiệu suất tối đa ngay khi bắt đầu
        enableMaximumPerformanceMode();
      };

      // Start sending frames
      isRecording = true;
      frameCount = 0;
      fps = 0;
      lastFpsUpdate = Date.now();

      startBtn.disabled = true;
      stopBtn.disabled = false;
      addLog(`Đã bắt đầu ghi hình với camera: ${getSelectedCameraName()}`);

      // Thiết lập xử lý cho các sự kiện nền của các tab browser để luôn duy trì hiệu suất cao
      enableContinuousHighPerformanceMode();
    } catch (error) {
      addLog(`Error accessing media: ${error.message}`);
      console.error("Error accessing media:", error);
    }
  } catch (error) {
    addLog(`Error starting capture: ${error.message}`);
    console.error("Error starting capture:", error);
  }
}

// Stop screen capture
function stopCapture() {
  isRecording = false;
  useBackgroundMode = false;
  currentPerformanceMode = PERFORMANCE_MODE.NORMAL;

  // Dừng animation frame nếu đang sử dụng
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  // Dừng interval nếu đang sử dụng
  if (frameInterval) {
    clearInterval(frameInterval);
    frameInterval = null;
  }

  // Dừng worker xử lý nền nếu đang hoạt động
  if (captureWorker) {
    try {
      captureWorker.postMessage({ command: "stop" });
      captureWorker.terminate();
    } catch (e) {
      console.error("Error terminating worker:", e);
    }
    captureWorker = null;
    addLog("Đã dừng worker xử lý nền");
  }

  // Dừng các kỹ thuật ngăn browser throttling
  if (window.BrowserKeepAlive) {
    window.BrowserKeepAlive.stopPreventing();
  }

  // Dừng media stream
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    mediaStream = null;
  }

  // Xóa bỏ frame cuối cùng để giải phóng bộ nhớ
  lastCaptureImage = null;

  startBtn.disabled = false;
  stopBtn.disabled = true;
  addLog("Screen capture stopped");
}

// Kết nối WebSocket
function connectWebSocket() {
  if (isConnecting) return false;

  isConnecting = true;
  try {
    addLog(`Connecting to WebSocket server: ${wsUrl}`);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      status.textContent = "Connected to WebSocket server";
      status.style.color = "green";
      addLog("WebSocket connection established");
      startBtn.disabled = false;

      // Reset reconnect parameters on successful connection
      reconnectAttempts = 0;
      reconnectInterval = 1000;
      isConnecting = false;

      // Tự động bắt đầu lại việc ghi hình nếu trước đó đang ghi
      if (wasRecording) {
        addLog("Auto-resuming screen capture after reconnection");
        setTimeout(() => startCapture(), 500); // Chờ 500ms để đảm bảo kết nối ổn định
        wasRecording = false; // Đặt lại trạng thái
      }
    };

    socket.onclose = (event) => {
      status.textContent = "Disconnected from WebSocket server";
      status.style.color = "red";
      addLog(`WebSocket connection closed: ${event.reason}`);
      startBtn.disabled = true;

      // Lưu trạng thái ghi hình trước khi dừng
      wasRecording = isRecording;

      stopCapture();
      isConnecting = false;

      // Schedule reconnection
      scheduleReconnect();
    };

    socket.onerror = (error) => {
      status.textContent = "WebSocket error";
      status.style.color = "red";
      addLog("WebSocket error occurred");
      console.error("WebSocket error:", error);
      isConnecting = false;
    };

    return true;
  } catch (error) {
    status.textContent = "Failed to connect to WebSocket server";
    status.style.color = "red";
    addLog(`Connection error: ${error.message}`);
    console.error("Connection error:", error);
    isConnecting = false;

    // Schedule reconnection on error
    scheduleReconnect();
    return false;
  }
}

// Lên lịch kết nối lại với backoff theo cấp số nhân
function scheduleReconnect() {
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
  }

  reconnectAttempts++;
  // Backoff theo cấp số nhân với jitter để tránh reconnection storms
  const jitter = Math.random() * 0.5 + 0.5; // Giá trị ngẫu nhiên giữa 0.5 và 1
  const timeout = Math.min(reconnectInterval * jitter, maxReconnectInterval);

  addLog(
    `Lên lịch kết nối lại lần thứ ${reconnectAttempts} sau ${Math.round(
      timeout / 1000
    )} giây...`
  );

  reconnectTimeoutId = setTimeout(() => {
    addLog(`Đang thử kết nối lại (lần thứ ${reconnectAttempts})...`);
    connectWebSocket();
    // Tăng khoảng thời gian cho lần kết nối tiếp theo (backoff theo cấp số nhân)
    reconnectInterval = Math.min(reconnectInterval * 1.5, maxReconnectInterval);
  }, timeout);
}

// Xử lý khi tab bị ẩn hoặc hiện
function handleVisibilityChange() {
  isPageVisible = !document.hidden;

  if (document.hidden) {
    // Tab không hiển thị - kích hoạt chế độ hiệu suất tối đa
    if (isRecording) {
      // Đảm bảo FPS luôn cao nhất ngay cả khi tab bị ẩn
      enableMaximumPerformanceMode();
    }
  } else {
    // Tab hiển thị trở lại - vẫn duy trì chế độ hiệu suất tối đa
    if (isRecording) {
      // Giữ chế độ hiệu suất tối đa hoặc khởi động lại nếu cần
      if (currentPerformanceMode !== PERFORMANCE_MODE.HIGH_PERFORMANCE) {
        enableMaximumPerformanceMode();
      }
      addLog("Tab hiển thị: Tiếp tục duy trì hiệu suất tối đa");
    }
  }
}

// Đăng ký sự kiện khi tài liệu đã tải xong
document.addEventListener("visibilitychange", handleVisibilityChange);

// Hàm cao cấp nhất để đảm bảo FPS cao dù ở chế độ ẩn
function enableMaximumPerformanceMode() {
  // Chuyển sang chế độ hiệu suất tối đa
  currentPerformanceMode = PERFORMANCE_MODE.HIGH_PERFORMANCE;
  addLog("Đã kích hoạt chế độ hiệu suất TỐI ĐA - luôn duy trì FPS cao nhất");

  // 1. Kích hoạt các kỹ thuật ngăn chặn throttling của trình duyệt
  if (window.BrowserKeepAlive) {
    window.BrowserKeepAlive.preventThrottling();
  }

  // 2. Thiết lập các cơ chế đảm bảo hiệu suất cao liên tục
  enableContinuousHighPerformanceMode();

  // 3. Cập nhật trạng thái hiển thị
  frameCounter.textContent = `Frames: ${frameCount} | FPS: ${fps} | Mode: TỐI ĐA`;
}

// Thiết lập các cơ chế đảm bảo hiệu suất cao liên tục
function enableContinuousHighPerformanceMode() {
  // Hàm xử lý chụp và gửi frame
  function captureAndSendFrame() {
    if (
      !isRecording ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      sendingFrame
    )
      return;

    try {
      sendingFrame = true;

      // Sử dụng các tùy chọn canvas tối ưu nhất cho hiệu suất
      const ctx = canvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
        willReadFrequently: true,
      });

      const processingCtx = processingCanvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
        willReadFrequently: true,
      });

      // Vẽ vào canvas với hiệu suất tối ưu
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      processingCtx.drawImage(
        video,
        0,
        0,
        currentResolution.width,
        currentResolution.height
      );

      // Chất lượng được chọn
      const quality = parseFloat(qualitySelect.value);

      // Nén và gửi hình ảnh
      processingCanvas.toBlob(
        (blob) => {
          if (socket && socket.readyState === WebSocket.OPEN && blob) {
            socket.send(blob);
            frameCount++;

            // Cập nhật FPS counter:229
            const now = Date.now();
            if (now - lastFpsUpdate >= 1000) {
              fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
              frameCounter.textContent = `Frames: ${frameCount} | FPS: ${fps} | Mode: TỐI ĐA`;
              lastFpsUpdate = now;
              frameCount = 0;
            }
          }
          sendingFrame = false;
        },
        "image/jpeg",
        quality
      );
    } catch (error) {
      console.error("Error in capture and send:", error);
      sendingFrame = false;
    }
  }

  // 1. Kiểm tra nếu tab đã ẩn và kích hoạt chế độ hiệu suất cao ngay
  if (document.hidden) {
    addLog("Tab đang bị ẩn: Kích hoạt chế độ hiệu suất tối đa");
  }

  // 2. Khởi tạo capture worker nếu chưa có
  if (!captureWorker) {
    try {
      captureWorker = new Worker("/public/scripts/capture/backgroundWorker.js");

      // Xử lý tin nhắn từ worker
      captureWorker.onmessage = function (e) {
        if (e.data.type === "requestFrame") {
          captureAndSendFrame();
        }
      };

      // Bắt đầu worker với FPS mục tiêu
      const targetFps =
        fpsModeSelect.value === "unlimited"
          ? 60 // Nhắm tới 60fps nếu unlimited
          : parseInt(frameRateSelect.value, 10);

      captureWorker.postMessage({
        command: "start",
        fps: targetFps,
      });

      addLog(
        `Đã kích hoạt worker xử lý nền với tốc độ FPS cao nhất (${targetFps} FPS)`
      );
    } catch (error) {
      console.error("Không thể tạo worker:", error);
      // Tiếp tục sử dụng requestAnimationFrame nếu không tạo được worker
    }
  }

  // 3. Sử dụng requestAnimationFrame song song với Web Worker để tránh bị throttle
  const keepMaxFPS = () => {
    if (!isRecording) return;

    // Chụp và gửi frame khi có thể
    if (!sendingFrame && socket?.readyState === WebSocket.OPEN) {
      captureAndSendFrame();
    }

    // Tiếp tục vòng lặp
    animationFrameId = requestAnimationFrame(keepMaxFPS);
  };

  // Bắt đầu vòng lặp FPS cao
  if (!animationFrameId) {
    animationFrameId = requestAnimationFrame(keepMaxFPS);
  }
}
