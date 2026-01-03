const MAX_LOG_ENTRIES = 50;
const SOCKETIO_SERVER_URL = "wss://localhost:3000";

// DOM Elements
const cameraListEl = document.getElementById("camera-list");
const previewCanvas = document.getElementById("preview-canvas");
const waitingMessage = document.getElementById("waiting-message");
const statusIndicator = document.getElementById("status-indicator");
const statusText = document.getElementById("status-text");
const totalVehiclesEl = document.getElementById("total-vehicles");
const processingTimeEl = document.getElementById("processing-time");
const vehiclesUpEl = document.getElementById("vehicles-up");
const vehiclesDownEl = document.getElementById("vehicles-down");
const vehicleTypesEl = document.getElementById("vehicle-types");
const logContainerEl = document.getElementById("log-container");

// Canvas context
const ctx = previewCanvas.getContext("2d");

// State variables
let socket = null;
let selectedCamera = null;
let latestImage = null;
let latestDetections = null;
let colorMap = new Map(); // For consistent colors based on class names

// Vehicle class icons (for stats display)
const vehicleIcons = {
  car: "fa-car",
  truck: "fa-truck",
  bus: "fa-bus",
  motorcycle: "fa-motorcycle",
  bicycle: "fa-bicycle",
};

// Initialize the application
document.addEventListener("DOMContentLoaded", () => {
  socket = io(SOCKETIO_SERVER_URL, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    upgrade: false,
  });

  fetchCameraList();
  setupResizeHandling();

  socket.on("connect", () => {
    updateConnectionStatus(true);
    addLogEntry("Connected to Socket.IO server");
  });

  socket.on("disconnect", () => {
    updateConnectionStatus(false);
    addLogEntry("Disconnected from Socket.IO server");
  });

  socket.on("image", handleImageData);
  socket.on("car_detected", handleDetectionData);
});

// Fetch the list of cameras from the API
function fetchCameraList() {
  fetch("/api/camera/all")
    .then((response) => response.json())
    .then((data) => {
      if (data.statusCode === 200 && data.metadata) {
        renderCameraList(data.metadata);
      } else {
        showError("Failed to load camera list");
      }
    })
    .catch((error) => {
      console.error("Error fetching camera list:", error);
      showError("Could not connect to the server");
    });
}

// Render the camera list UI
function renderCameraList(cameras) {
  cameraListEl.innerHTML = "";

  if (!cameras || cameras.length === 0) {
    cameraListEl.innerHTML = '<div class="no-cameras">No cameras found</div>';
    return;
  }

  cameras.forEach((camera) => {
    const cameraEl = document.createElement("div");
    cameraEl.className = "camera-item";
    cameraEl.dataset.id = camera._id;
    cameraEl.innerHTML = `
      <div class="camera-name">${camera.camera_name}</div>
      <div class="camera-location">${camera.camera_location}</div>
    `;

    cameraEl.addEventListener("click", () => selectCamera(camera));
    cameraListEl.appendChild(cameraEl);
  });

  addLogEntry("Camera list loaded successfully");
}

// Handle camera selection
function selectCamera(camera) {
  // Update UI to show selected camera
  document.querySelectorAll(".camera-item").forEach((el) => {
    el.classList.remove("active");
  });

  const selectedEl = document.querySelector(
    `.camera-item[data-id="${camera._id}"]`
  );
  if (selectedEl) {
    selectedEl.classList.add("active");
  }

  if (selectedCamera) {
    socket.emit("leave_camera", selectedCamera._id);
    addLogEntry(`Left camera room: ${selectedCamera._id}`);
  }

  socket.emit("join_camera", camera._id);
  addLogEntry(`Joined camera room: ${camera._id}`);

  selectedCamera = camera;

  // Reset state
  latestImage = null;
  latestDetections = null;

  // Update UI
  waitingMessage.textContent = "Connecting to camera stream...";
  waitingMessage.style.display = "flex";

  addLogEntry(`Selected camera: ${camera.camera_name}`);
}

// Update connection status UI
function updateConnectionStatus(isConnected) {
  if (isConnected) {
    statusIndicator.classList.add("connected");
    statusText.textContent = "Connected";
  } else {
    statusIndicator.classList.remove("connected");
    statusText.textContent = "Disconnected";
    waitingMessage.textContent = "Connection lost. Reconnecting...";
    waitingMessage.style.display = "flex";
  }
}

// Handle incoming image data
function handleImageData(data) {
  try {
    if (!data || !data.buffer) return;

    const cameraId = data.cameraId;

    // Check if this image is from our selected camera
    if (!selectedCamera || cameraId !== selectedCamera._id) return;

    // Convert base64 image to displayable format
    let imageBytes;
    if (typeof data.buffer === "string") {
      // If it's base64 encoded
      imageBytes = atob(data.buffer);
    } else if (data.buffer instanceof ArrayBuffer) {
      // If it's already a binary array
      imageBytes = new Uint8Array(data.buffer);
    } else {
      return;
    }

    // Create blob and convert to image
    const blob = new Blob([imageBytes], { type: "image/jpeg" });
    const imageUrl = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = function () {
      latestImage = {
        img: img,
        trackLineY: data.track_line_y,
        width: data.width,
        height: data.height,
        timestamp: data.created_at,
      };

      // Hide waiting message now that we have an image
      waitingMessage.style.display = "none";

      // Draw the frame
      drawScene();

      // Clean up
      URL.revokeObjectURL(imageUrl);
    };
    img.src = imageUrl;
  } catch (error) {
    addLogEntry(`Error processing image: ${error.message}`);
  }
}

// Handle incoming detection data
function handleDetectionData(data) {
  console.log({ data });

  try {
    if (!data) return;

    const cameraId = data.camera_id;

    // Check if this detection is from our selected camera
    if (!selectedCamera || cameraId !== selectedCamera._id) return;

    // Store the latest detection data
    latestDetections = data;

    // Update stats UI
    updateStatistics(data);

    // Draw the scene with detections
    drawScene();
  } catch (error) {
    addLogEntry(`Error processing detection data: ${error.message}`);
  }
}

// Update statistics display
function updateStatistics(data) {
  // Total vehicles
  const totalVehicles = data.detections ? data.detections.length : 0;
  totalVehiclesEl.textContent = totalVehicles;

  // Processing time
  if (data.inference_time) {
    processingTimeEl.textContent = `${data.inference_time.toFixed(1)} ms`;
  }

  // Vehicle counts by direction
  if (data.vehicle_count) {
    vehiclesUpEl.textContent = data.vehicle_count.total_up || 0;
    vehiclesDownEl.textContent = data.vehicle_count.total_down || 0;

    // Vehicle types breakdown
    vehicleTypesEl.innerHTML = "";
    if (data.vehicle_count.current) {
      Object.entries(data.vehicle_count.current).forEach(([type, count]) => {
        if (count > 0) {
          const iconClass = vehicleIcons[type] || "fa-car";

          const vehicleItem = document.createElement("div");
          vehicleItem.className = "vehicle-type-item";
          vehicleItem.innerHTML = `
            <div class="vehicle-type-icon">
              <i class="fas ${iconClass}"></i>
            </div>
            <div class="vehicle-type-label">${capitalize(type)}</div>
            <div class="vehicle-type-count">${count}</div>
          `;
          vehicleTypesEl.appendChild(vehicleItem);
        }
      });
    }
  }
}

// Main drawing function
function drawScene() {
  if (!ctx || !latestImage) return;

  // Get canvas dimensions
  const canvasWidth = previewCanvas.width;
  const canvasHeight = previewCanvas.height;

  // Clear canvas
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Draw the base image
  const img = latestImage.img;
  ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);

  // Draw the tracking line if available
  if (latestImage.trackLineY) {
    drawTrackingLine(latestImage.trackLineY, canvasWidth, canvasHeight);
  }

  // Draw detections if available
  if (latestDetections && latestDetections.detections) {
    drawDetections(latestDetections.detections, canvasWidth, canvasHeight);
  }

  // Draw tracks if available
  if (latestDetections && latestDetections.tracks) {
    drawTracks(latestDetections.tracks, canvasWidth, canvasHeight);
  }
}

// Draw tracking line
function drawTrackingLine(trackLineYPercent, canvasWidth, canvasHeight) {
  const y = (trackLineYPercent / 100) * canvasHeight;

  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(canvasWidth, y);
  ctx.strokeStyle = "rgba(0, 255, 255, 0.8)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Add label
  ctx.font = "12px Arial";
  ctx.fillStyle = "rgba(0, 255, 255, 1)";
  ctx.fillText("Counting Line", 10, y - 5);
}

// Draw detection boxes
function drawDetections(detections, canvasWidth, canvasHeight) {
  detections.forEach((detection) => {
    const bbox = detection.bbox;
    const className = detection.class;
    const confidence = detection.confidence;

    // Get color for this class
    const color = getColorForClass(className);
    const colorString = `rgb(${color.r}, ${color.g}, ${color.b})`;

    // Calculate pixel coordinates from normalized coordinates
    const x1 = bbox.x1 * canvasWidth;
    const y1 = bbox.y1 * canvasHeight;
    const x2 = bbox.x2 * canvasWidth;
    const y2 = bbox.y2 * canvasHeight;
    const boxWidth = x2 - x1;
    const boxHeight = y2 - y1;

    // Draw bounding box
    ctx.strokeStyle = colorString;
    ctx.lineWidth = 2;
    ctx.strokeRect(x1, y1, boxWidth, boxHeight);

    // Draw label background
    const label = `${className}: ${confidence.toFixed(2)}`;
    ctx.font = "12px Arial";
    const labelWidth = ctx.measureText(label).width + 10;
    const labelHeight = 20;

    ctx.fillStyle = colorString;
    ctx.fillRect(x1, y1 - labelHeight, labelWidth, labelHeight);

    // Calculate text color based on background brightness
    const brightness =
      (color.r * 0.299 + color.g * 0.587 + color.b * 0.114) / 255;
    const textColor = brightness > 0.5 ? "black" : "white";

    // Draw label text
    ctx.fillStyle = textColor;
    ctx.fillText(label, x1 + 5, y1 - 5);
  });
}

// Draw vehicle tracks
function drawTracks(tracks, canvasWidth, canvasHeight) {
  tracks.forEach((track) => {
    if (track.positions && track.positions.length >= 2) {
      // Choose color based on vehicle class
      let color;
      const vehicleClass = track.class;

      switch (vehicleClass) {
        case "car":
          color = "rgba(0, 255, 0, 0.8)"; // Green
          break;
        case "truck":
          color = "rgba(0, 0, 255, 0.8)"; // Blue
          break;
        case "bus":
          color = "rgba(255, 0, 0, 0.8)"; // Red
          break;
        case "motorcycle":
          color = "rgba(255, 255, 0, 0.8)"; // Yellow
          break;
        case "bicycle":
          color = "rgba(255, 0, 255, 0.8)"; // Purple
          break;
        default:
          color = "rgba(255, 165, 0, 0.8)"; // Orange
      }

      // Draw track line
      ctx.beginPath();

      // Sort positions by time (just to be sure)
      const sortedPositions = [...track.positions].sort(
        (a, b) => a.time - b.time
      );

      // Draw trail
      for (let i = 0; i < sortedPositions.length; i++) {
        const pos = sortedPositions[i];
        const x = pos.x;
        const y = pos.y;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        // For the last position, draw the ID
        if (i === sortedPositions.length - 1) {
          ctx.font = "12px Arial";
          ctx.fillStyle = color;
          ctx.fillText(`ID:${track.id}`, x + 5, y - 5);
        }
      }

      // Style and stroke the path
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
}

// Get a consistent color for a class name
function getColorForClass(className) {
  if (!colorMap.has(className)) {
    // Generate a hash from the class name
    let hash = 0;
    for (let i = 0; i < className.length; i++) {
      hash = className.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Convert to RGB color
    const r = hash & 0xff;
    const g = (hash >> 8) & 0xff;
    const b = (hash >> 16) & 0xff;

    colorMap.set(className, { r, g, b });
  }

  return colorMap.get(className);
}

// Handle window resize
function setupResizeHandling() {
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
}

// Resize canvas to fit container
function resizeCanvas() {
  const container = previewCanvas.parentElement;
  previewCanvas.width = container.clientWidth;
  previewCanvas.height = container.clientHeight;

  // Redraw if we have data
  if (latestImage) {
    drawScene();
  }
}

// Add entry to the log display
function addLogEntry(message) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = `[${timestamp}] ${message}`;

  logContainerEl.appendChild(entry);

  // Limit the number of log entries
  while (logContainerEl.children.length > MAX_LOG_ENTRIES) {
    logContainerEl.removeChild(logContainerEl.firstChild);
  }

  // Auto-scroll to bottom
  logContainerEl.scrollTop = logContainerEl.scrollHeight;
}

// Show error in camera list
function showError(message) {
  cameraListEl.innerHTML = `<div class="error-message">${message}</div>`;
}

// Helper function to capitalize first letter
function capitalize(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}
