const SOCKETIO_SERVER_URL = "wss://localhost:3001";
const MAX_LOG_ENTRIES = 50;
const FRAME_RATE_LIMIT = 30; // Max frames per second to process

// Canvas setup
const canvas = document.getElementById("preview-canvas");
const ctx = canvas.getContext("2d");
const carCanvas = document.getElementById("car-canvas");
const carCtx = carCanvas.getContext("2d");

// State variables
let socket;
let connected = false;
let latestImage = null;
let latestCarImage = null;
let latestTrafficSignData = null;
let latestVehicleData = null;
let frameCount = 0;
let carFrameCount = 0;
let lastFrameTime = 0;
let lastCarFrameTime = 0;
let currentFps = 0;
let colorMap = new Map(); // For consistent colors based on class names

// DOM elements
const statusIndicator = document.getElementById("status-indicator");
const statusText = document.getElementById("status-text");
const statusMessage = document.getElementById("status-message");
const carStatusMessage = document.getElementById("car-status-message");
const timestampDisplay = document.getElementById("timestamp");
const fpsDisplay = document.getElementById("fps");
const carTimestampDisplay = document.getElementById("car-timestamp");
const totalSignsDisplay = document.getElementById("total-signs");
const signDetectionTimeDisplay = document.getElementById("sign-detection-time");
const signCountsDisplay = document.getElementById("sign-counts");
const totalVehiclesDisplay = document.getElementById("total-vehicles");
const vehicleDetectionTimeDisplay = document.getElementById(
  "vehicle-detection-time"
);
const vehiclesUpDisplay = document.getElementById("vehicles-up");
const vehiclesDownDisplay = document.getElementById("vehicles-down");
const vehicleCountsDisplay = document.getElementById("vehicle-counts");
const logContainer = document.getElementById("log-container");

// Initialize the web app
function init() {
  // Set initial canvas size
  resizeCanvas();
  resizeCarCanvas();
  window.addEventListener("resize", () => {
    resizeCanvas();
    resizeCarCanvas();
  });

  // Connect to Socket.IO server
  connectToServer();

  // Start the render loop
  requestAnimationFrame(renderLoop);

  // Add event log
  addLogEntry("Application initialized, connecting to server...");
}

// Connect to Socket.IO server
function connectToServer() {
  try {
    socket = io(SOCKETIO_SERVER_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    // Socket.IO event handlers
    socket.on("connect", () => {
      connected = true;
      updateConnectionStatus(true);
      addLogEntry("Connected to server");
    });

    socket.on("disconnect", () => {
      connected = false;
      updateConnectionStatus(false);
      addLogEntry("Disconnected from server");
    });

    socket.on("connect_error", (error) => {
      connected = false;
      updateConnectionStatus(false);
      addLogEntry(`Connection error: ${error.message}`);
    });

    // Image data handler
    socket.on("image", handleImageData);

    // Traffic sign detection handler
    socket.on("traffic_light", handleTrafficSignData);

    // Vehicle detection handler
    socket.on("car_detected", handleVehicleData);

    // Car image handler
    socket.on("car", handleCarImageData);
  } catch (error) {
    addLogEntry(`Error initializing Socket.IO: ${error.message}`);
  }
}

// Update the connection status UI
function updateConnectionStatus(isConnected) {
  if (isConnected) {
    statusIndicator.style.backgroundColor = "var(--connected-color)";
    statusText.textContent = "Connected";
    statusMessage.style.display = "none";
  } else {
    statusIndicator.style.backgroundColor = "var(--disconnected-color)";
    statusText.textContent = "Disconnected";
    statusMessage.style.display = "flex";
    statusMessage.textContent = "Waiting for connection...";
    carStatusMessage.style.display = "flex";
    carStatusMessage.textContent = "Waiting for connection...";
  }
}

// Resize main canvas to fit container
function resizeCanvas() {
  const container = canvas.parentElement;
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;

  // Redraw if we have data
  if (latestImage) {
    drawScene();
  }
}

// Resize car canvas to fit container
function resizeCarCanvas() {
  const container = carCanvas.parentElement;
  carCanvas.width = container.clientWidth;
  carCanvas.height = container.clientHeight;

  // Redraw if we have data
  if (latestCarImage) {
    drawCarImage();
  }
}

// Add entry to the log display
function addLogEntry(message) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = `[${timestamp}] ${message}`;

  logContainer.appendChild(entry);

  // Limit the number of log entries
  while (logContainer.children.length > MAX_LOG_ENTRIES) {
    logContainer.removeChild(logContainer.firstChild);
  }

  // Auto-scroll to bottom
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Handle image data from Socket.IO
function handleImageData(data) {
  try {
    const now = performance.now();

    // Throttle frame processing to our frame rate limit
    if (now - lastFrameTime < 1000 / FRAME_RATE_LIMIT) {
      return;
    }

    lastFrameTime = now;

    // Convert image data
    let imageBytes;
    if (typeof data === "string") {
      // If it's base64 encoded
      imageBytes = atob(data);
    } else if (data instanceof ArrayBuffer) {
      // If it's already a binary array
      imageBytes = new Uint8Array(data);
    } else if (data.image) {
      // If it's in an object with image key
      if (typeof data.image === "string") {
        imageBytes = atob(data.image);
      } else {
        imageBytes = new Uint8Array(data.image);
      }
    }

    if (imageBytes) {
      // Create blob and convert to image
      const blob = new Blob([imageBytes], { type: "image/jpeg" });
      const imageUrl = URL.createObjectURL(blob);

      const img = new Image();
      img.onload = function () {
        latestImage = img;
        URL.revokeObjectURL(imageUrl); // Clean up

        // Update timestamp
        const now = new Date();
        timestampDisplay.textContent = now.toLocaleTimeString();

        // Update FPS counter
        frameCount++;
        const elapsed = (performance.now() - lastFrameTime) / 1000;
        if (elapsed >= 1.0) {
          currentFps = Math.round(frameCount / elapsed);
          frameCount = 0;
          lastFrameTime = performance.now();
        }
        fpsDisplay.textContent = `FPS: ${currentFps}`;

        // No need to explicitly call drawScene() here as renderLoop handles it
      };
      img.src = imageUrl;
    }
  } catch (error) {
    addLogEntry(`Error processing image: ${error.message}`);
  }
}

// Handle car image data from Socket.IO
function handleCarImageData(data) {
  try {
    // Convert image data
    let imageBytes;

    if (typeof data.image_data === "string") {
      // If it's base64 encoded
      imageBytes = atob(data.image_data);
    } else if (data.image_data instanceof ArrayBuffer) {
      // If it's already a binary array
      imageBytes = new Uint8Array(data.image_data);
    } else if (data.image_data && data.image_data.image) {
      if (typeof data.image_data.image === "string") {
        imageBytes = atob(data.image_data.image);
      } else {
        imageBytes = new Uint8Array(data.image_data.image);
      }
    }

    if (imageBytes) {
      // Create blob and convert to image
      const blob = new Blob([imageBytes], { type: "image/jpeg" });
      const imageUrl = URL.createObjectURL(blob);

      console.log("Car image URL:", imageUrl); // Debugging line

      const img = new Image();
      img.onload = function () {
        latestCarImage = img;
        URL.revokeObjectURL(imageUrl); // Clean up

        // Update timestamp
        const now = new Date();
        if (carTimestampDisplay) {
          carTimestampDisplay.textContent = now.toLocaleTimeString();
        }

        // Hide waiting message
        if (carStatusMessage) {
          carStatusMessage.style.display = "none";
        }

        // Draw car image
        drawCarImage();

        // Log car image event
        addLogEntry("Received car detection image");
      };
      img.src = imageUrl;
    }
  } catch (error) {
    addLogEntry(`Error processing car image: ${error.message}`);
  }
}

// Handle traffic sign detection data
function handleTrafficSignData(data) {
  latestTrafficSignData = data;

  console.log({
    latestTrafficSignData,
  });

  try {
    // Update UI with traffic sign data
    if (data.detections && Array.isArray(data.detections)) {
      const signCount = data.detections.length;
      totalSignsDisplay.textContent = signCount;

      if (data.inference_time) {
        signDetectionTimeDisplay.textContent = `${data.inference_time.toFixed(
          1
        )} ms`;
      }

      // Update sign counts
      signCountsDisplay.innerHTML = "";
      if (data.sign_counts) {
        Object.entries(data.sign_counts).forEach(([type, count]) => {
          // Generate a color based on the sign type
          let color = getColorForClass(type);

          const signItem = document.createElement("div");
          signItem.className = "detailed-stat-item";
          signItem.style.backgroundColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.2)`;
          signItem.innerHTML = `
                        <span class="label">${type}:</span>
                        <span class="value">${count}</span>
                    `;
          signCountsDisplay.appendChild(signItem);
        });
      }

      addLogEntry(`Received ${signCount} traffic sign detections`);
    }
  } catch (error) {
    addLogEntry(`Error processing traffic sign data: ${error.message}`);
  }
}

// Handle vehicle detection data
function handleVehicleData(data) {
  latestVehicleData = data;

  try {
    // Update UI with vehicle data
    if (data.detections && Array.isArray(data.detections)) {
      const vehicleCount = data.detections.length;
      totalVehiclesDisplay.textContent = vehicleCount;

      if (data.inference_time) {
        vehicleDetectionTimeDisplay.textContent = `${data.inference_time.toFixed(
          1
        )} ms`;
      }

      // Update vehicle counts
      if (data.vehicle_count) {
        vehiclesUpDisplay.textContent = data.vehicle_count.total_up || 0;
        vehiclesDownDisplay.textContent = data.vehicle_count.total_down || 0;

        // Update vehicle counts by type
        vehicleCountsDisplay.innerHTML = "";
        if (data.vehicle_count.current) {
          Object.entries(data.vehicle_count.current).forEach(
            ([type, count]) => {
              if (count > 0) {
                const vehicleItem = document.createElement("div");
                vehicleItem.className = `detailed-stat-item ${type}-color`;
                vehicleItem.innerHTML = `
                                <span class="label">${type}s:</span>
                                <span class="value">${count}</span>
                            `;
                vehicleCountsDisplay.appendChild(vehicleItem);
              }
            }
          );
        }
      }

      addLogEntry(`Received ${vehicleCount} vehicle detections`);
    }
  } catch (error) {
    addLogEntry(`Error processing vehicle data: ${error.message}`);
  }
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

// Main render loop
function renderLoop() {
  drawScene();
  requestAnimationFrame(renderLoop);
}

// Draw the main scene with all overlays
function drawScene() {
  if (!ctx) return;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Check if we have an image to display
  if (!latestImage) {
    drawWaitingMessage("Waiting for image data...");
    return;
  }

  // Calculate aspect ratio to maintain image proportions
  const imageAspect = latestImage.width / latestImage.height;
  const canvasAspect = canvas.width / canvas.height;

  let drawWidth, drawHeight, offsetX, offsetY;

  if (imageAspect > canvasAspect) {
    // Image is wider than canvas (relative to heights)
    drawWidth = canvas.width;
    drawHeight = canvas.width / imageAspect;
    offsetX = 0;
    offsetY = (canvas.height - drawHeight) / 2;
  } else {
    // Image is taller than canvas (relative to widths)
    drawHeight = canvas.height;
    drawWidth = canvas.height * imageAspect;
    offsetX = (canvas.width - drawWidth) / 2;
    offsetY = 0;
  }

  // Draw the base image
  ctx.drawImage(latestImage, offsetX, offsetY, drawWidth, drawHeight);

  // Draw traffic sign detection overlays
  if (latestTrafficSignData && latestTrafficSignData.detections) {
    drawTrafficSignOverlays(offsetX, offsetY, drawWidth, drawHeight);
  }

  // Draw vehicle detection overlays
  if (latestVehicleData && latestVehicleData.detections) {
    drawVehicleOverlays(offsetX, offsetY, drawWidth, drawHeight);
  }
}

// Draw the car image
function drawCarImage() {
  if (!carCtx || !latestCarImage) return;

  // Clear canvas
  carCtx.clearRect(0, 0, carCanvas.width, carCanvas.height);

  // Calculate aspect ratio to maintain image proportions
  const imageAspect = latestCarImage.width / latestCarImage.height;
  const canvasAspect = carCanvas.width / carCanvas.height;

  let drawWidth, drawHeight, offsetX, offsetY;

  if (imageAspect > canvasAspect) {
    // Image is wider than canvas (relative to heights)
    drawWidth = carCanvas.width;
    drawHeight = carCanvas.width / imageAspect;
    offsetX = 0;
    offsetY = (carCanvas.height - drawHeight) / 2;
  } else {
    // Image is taller than canvas (relative to widths)
    drawHeight = carCanvas.height;
    drawWidth = carCanvas.height * imageAspect;
    offsetX = (carCanvas.width - drawWidth) / 2;
    offsetY = 0;
  }

  // Draw the car image
  carCtx.drawImage(latestCarImage, offsetX, offsetY, drawWidth, drawHeight);

  // Add a border/highlight to make it clear this is a detected car
  carCtx.strokeStyle = "var(--vehicle-color)";
  carCtx.lineWidth = 2;
  carCtx.strokeRect(offsetX, offsetY, drawWidth, drawHeight);
}

// Draw waiting message when no image is available
function drawWaitingMessage(message) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = "18px Arial";
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, canvas.width / 2, canvas.height / 2);
}

// Draw traffic sign detection overlays
function drawTrafficSignOverlays(offsetX, offsetY, drawWidth, drawHeight) {
  const detections = latestTrafficSignData.detections;

  detections.forEach((detection) => {
    const bbox = detection.bbox;
    const className = detection.class;
    const confidence = detection.confidence;

    // Get color for this class
    const color = getColorForClass(className);
    const colorString = `rgb(${color.r}, ${color.g}, ${color.b})`;

    // Calculate pixel coordinates based on relative coordinates
    const x1 = offsetX + bbox.x1 * drawWidth;
    const y1 = offsetY + bbox.y1 * drawHeight;
    const x2 = offsetX + bbox.x2 * drawWidth;
    const y2 = offsetY + bbox.y2 * drawHeight;
    const boxWidth = x2 - x1;
    const boxHeight = y2 - y1;

    // Draw bounding box
    ctx.strokeStyle = colorString;
    ctx.lineWidth = 2;
    ctx.strokeRect(x1, y1, boxWidth, boxHeight);

    // Draw label background
    const label = `${className}: ${confidence.toFixed(2)}`;
    ctx.font = "14px Arial";
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

// Draw vehicle detection overlays
function drawVehicleOverlays(offsetX, offsetY, drawWidth, drawHeight) {
  // Draw counting line if available
  if (
    latestVehicleData.counting_line &&
    latestVehicleData.counting_line.y !== null
  ) {
    const lineY =
      offsetY +
      (latestVehicleData.counting_line.y /
        latestVehicleData.image_dimensions.height) *
      drawHeight;
    const startX = offsetX;
    const endX = offsetX + drawWidth;

    ctx.beginPath();
    ctx.moveTo(startX, lineY);
    ctx.lineTo(endX, lineY);
    ctx.strokeStyle = "rgba(0, 255, 255, 0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Add label for counting line
    ctx.font = "14px Arial";
    ctx.fillStyle = "rgba(0, 255, 255, 1)";
    ctx.fillText("Vehicle Counting Line", startX + 10, lineY - 5);
  }

  // Draw tracks if available
  if (latestVehicleData.tracks && latestVehicleData.tracks.length > 0) {
    latestVehicleData.tracks.forEach((track) => {
      if (track.positions && track.positions.length >= 2) {
        // Get vehicle type color
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
            color = "rgba(255, 255, 0, 0.8)"; // Default yellow
        }

        // Draw trail lines
        ctx.beginPath();

        // Sort positions by time
        const sortedPositions = [...track.positions].sort(
          (a, b) => a.time - b.time
        );

        for (let i = 0; i < sortedPositions.length - 1; i++) {
          const pos1 = sortedPositions[i];
          const pos2 = sortedPositions[i + 1];

          // Calculate screen coordinates
          const x1 =
            offsetX +
            (pos1.x / latestVehicleData.image_dimensions.width) * drawWidth;
          const y1 =
            offsetY +
            (pos1.y / latestVehicleData.image_dimensions.height) * drawHeight;
          const x2 =
            offsetX +
            (pos2.x / latestVehicleData.image_dimensions.width) * drawWidth;
          const y2 =
            offsetY +
            (pos2.y / latestVehicleData.image_dimensions.height) * drawHeight;

          if (i === 0) {
            ctx.moveTo(x1, y1);
          }

          ctx.lineTo(x2, y2);

          // For the last position, draw the ID
          if (i === sortedPositions.length - 2) {
            ctx.font = "12px Arial";
            ctx.fillStyle = color;
            ctx.fillText(`ID:${track.id}`, x2 + 5, y2);
          }
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  }

  // Draw vehicle bounding boxes
  latestVehicleData.detections.forEach((detection) => {
    const bbox = detection.bbox;
    const className = detection.class;
    const confidence = detection.confidence;
    const trackId = detection.track_id;

    // Choose color based on vehicle type
    let colorString;
    switch (className) {
      case "car":
        colorString = "rgb(0, 255, 0)"; // Green
        break;
      case "truck":
        colorString = "rgb(0, 0, 255)"; // Blue
        break;
      case "bus":
        colorString = "rgb(255, 0, 0)"; // Red
        break;
      case "motorcycle":
        colorString = "rgb(255, 255, 0)"; // Yellow
        break;
      case "bicycle":
        colorString = "rgb(255, 0, 255)"; // Purple
        break;
      default:
        colorString = "rgb(0, 255, 0)"; // Default green
    }

    // Calculate pixel coordinates based on relative coordinates
    const x1 = offsetX + bbox.x1 * drawWidth;
    const y1 = offsetY + bbox.y1 * drawHeight;
    const x2 = offsetX + bbox.x2 * drawWidth;
    const y2 = offsetY + bbox.y2 * drawHeight;
    const boxWidth = x2 - x1;
    const boxHeight = y2 - y1;

    // Draw bounding box
    ctx.strokeStyle = colorString;
    ctx.lineWidth = 2;
    ctx.strokeRect(x1, y1, boxWidth, boxHeight);

    // Draw label background
    let label = `${className}: ${confidence.toFixed(2)}`;
    if (trackId !== undefined) {
      label += ` ID:${trackId}`;
    }

    ctx.font = "14px Arial";
    const labelWidth = ctx.measureText(label).width + 10;
    const labelHeight = 20;

    ctx.fillStyle = colorString;
    ctx.fillRect(x1, y1 - labelHeight, labelWidth, labelHeight);

    // Determine optimal text color based on background
    let textColor;
    switch (className) {
      case "car":
      case "motorcycle":
        textColor = "black";
        break;
      default:
        textColor = "white";
    }

    // Draw label text
    ctx.fillStyle = textColor;
    ctx.fillText(label, x1 + 5, y1 - 5);
  });

  // Draw counters for up/down if available
  if (latestVehicleData.vehicle_count) {
    const totalUp = latestVehicleData.vehicle_count.total_up || 0;
    const totalDown = latestVehicleData.vehicle_count.total_down || 0;

    if (
      latestVehicleData.counting_line &&
      latestVehicleData.counting_line.y !== null
    ) {
      const lineY =
        offsetY +
        (latestVehicleData.counting_line.y /
          latestVehicleData.image_dimensions.height) *
        drawHeight;

      // Up counter (right side)
      const upX = offsetX + drawWidth - 150;
      const upY = lineY - 100;

      ctx.fillStyle = "rgba(0, 255, 0, 0.7)";
      ctx.fillRect(upX, upY, 130, 70);

      ctx.font = "bold 16px Arial";
      ctx.fillStyle = "black";
      ctx.fillText("▲ UP COUNT", upX + 10, upY + 25);

      ctx.font = "bold 24px Arial";
      ctx.fillText(`${totalUp}`, upX + 10, upY + 55);

      // Down counter (left side)
      const downX = offsetX + 20;
      const downY = lineY + 30;

      ctx.fillStyle = "rgba(255, 165, 0, 0.7)";
      ctx.fillRect(downX, downY, 130, 70);

      ctx.font = "bold 16px Arial";
      ctx.fillStyle = "black";
      ctx.fillText("▼ DOWN COUNT", downX + 10, downY + 25);

      ctx.font = "bold 24px Arial";
      ctx.fillText(`${totalDown}`, downX + 10, downY + 55);
    }
  }
}

// Initialize the application
document.addEventListener("DOMContentLoaded", init);
