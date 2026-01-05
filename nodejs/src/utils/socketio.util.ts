// NOTE: car_detected handling đã được di chuyển sang websocket.service.ts
// để tránh memory leak do circular emit loop

import cameraModel from "@/models/camera.model.js";
import cameraImageModel from "@/models/cameraImage.model.js";
import licensePlateDetectedModel from "@/models/licensePlateDetected.model.js";
import trafficLightModel from "@/models/trafficLight.model.js";
import { pushImage, setTrafficLightStatus } from "@/services/redis.service.js";
import violationService from "@/services/violation.service.js";
import { websocketAnalytics } from "@/services/websocketAnalytics.service.js";
import { Types } from "mongoose";
import { Socket } from "socket.io";
import { ViolationLicensePlateDetect } from "./socketio.util.d.js";
import { streamManager } from "@/services/stream.service.js";
import { ffmpegManager } from "@/services/ffmpeg.service.js";

/* -------------------------------------------------------------------------- */
/*                            Use strategy pattern                            */
/* -------------------------------------------------------------------------- */
const strategy = {
  /* ---------------------------- Join room handler --------------------------- */
  join_camera: handleJoinCameraEvent,
  join_all_camera: handleJoinAllCameraEvent,
  leave_camera: handleLeaveCameraEvent,

  /* ------------------------------ Event handler ----------------------------- */
  image: handleImageEvent,
  traffic_light: handleTrafficLightEvent,
  // NOTE: car_detected đã được di chuyển sang websocket.service.ts để tránh memory leak
  violation_license_plate: handleViolationLicensePlateEvent,
};

export default function handleEvent(event: keyof typeof strategy) {
  const handler = strategy[event];

  return handler;
}

/* -------------------------------------------------------------------------- */
/*                          Handle 'join_camera' event handler                */
/* -------------------------------------------------------------------------- */
export async function handleJoinCameraEvent(this: Socket, cameraId: string) {
  const socket = this;
  socket.join(`camera_${cameraId}`);
}

/* -------------------------------------------------------------------------- */
/*                          Handle 'join_all_camera' event handler          */
/* -------------------------------------------------------------------------- */
export async function handleJoinAllCameraEvent(this: Socket) {
  const socket = this;

  console.log("join_all_camera by client:", socket.id);

  const cameraIds = await cameraModel.find({}, { _id: 1 }).lean();

  const rooms = cameraIds.map(id => `camera_${id._id}`);
  console.log(`[SocketIO] Client ${socket.id} joining rooms:`, rooms);

  cameraIds.forEach((id) => {
    socket.join(`camera_${id._id}`);
  });
}

/* -------------------------------------------------------------------------- */
/*                          Handle 'leave_camera' event handler              */
/* -------------------------------------------------------------------------- */
export async function handleLeaveCameraEvent(this: Socket, cameraId: string) {
  const socket = this;
  socket.leave(`camera_${cameraId}`);
}

// Rate limiting map for 1FPS saving
const lastImageSaveTime = new Map<string, number>();
// Rate limiting for YOLO API calls (5 FPS max)
const lastYoloApiTime = new Map<string, number>();
const YOLO_API_MIN_INTERVAL = 200; // 200ms = 5 FPS max

/* -------------------------------------------------------------------------- */
/*                          Handle 'image' event handler                      */
/* -------------------------------------------------------------------------- */
export async function handleImageEvent(
  this: Socket,
  data: {
    cameraId: string;
    imageId: string;
    width: number;
    height: number;
    buffer: Buffer;
    created_at: number;
    track_line_y: number;
  }
) {
  const socket = this;

  const payload = {
    cameraId: data.cameraId,
    imageId: data.imageId,
    width: data.width,
    height: data.height,
    buffer: data.buffer,
    created_at: data.created_at,
    track_line_y: data.track_line_y,
  };

  // socket.broadcast.emit("image", payload); // Disabled: Using HLS
  // socket.emit("image", payload); // Send back to sender // Disabled

  // Push to FFmpeg Stream (Multi-Camera)
  try {
    const imgBuffer = Buffer.from(data.buffer);

    // Ensure specific camera stream is active
    ffmpegManager.startStream(data.cameraId);
    streamManager.pushData(data.cameraId, imgBuffer);

  } catch (err) {
    console.error("[Stream] Push error:", err);
  }

  websocketAnalytics.transferData(data.buffer.length, 1);

  try {
    // 1. Cache to Redis (Every frame - Max FPS)
    pushImage(data.cameraId, {
      imageId: data.imageId || new Types.ObjectId().toString(),
      image: data.buffer,
      created_at: data.created_at,
      width: data.width,
      height: data.height
    });

    // 2. Save to MongoDB (1 FPS Throttling)
    const now = Date.now();
    const lastSaved = lastImageSaveTime.get(data.cameraId) || 0;

    if (now - lastSaved >= 1000) {
      await cameraImageModel.create({
        _id: data.imageId || new Types.ObjectId(),
        cameraId: data.cameraId,
        image: data.buffer,
        width: data.width,
        height: data.height,
        created_at: data.created_at,
      });
      lastImageSaveTime.set(data.cameraId, now);
    }

    // 3. Send to YOLO API (Kaggle) for detection - Rate limited
    const lastApiCall = lastYoloApiTime.get(data.cameraId) || 0;
    if (now - lastApiCall >= YOLO_API_MIN_INTERVAL) {
      lastYoloApiTime.set(data.cameraId, now);

      // Call API asynchronously (don't await to not block)
      /* Disabled: Kaggle now pulls from HLS stream
      callYoloApiAndEmit(socket, data).catch((err) => {
        console.error("[YOLO API] Detection error:", err.message);
      });
      */
    }

  } catch (error: any) {
    console.error("Image autosave/cache failed:", error.message);
  }
}

// Helper function to call YOLO API and emit results
async function callYoloApiAndEmit(socket: Socket, data: any) {
  const { yoloApiService } = await import("@/services/yoloApi.service.js");

  if (!yoloApiService.isConfigured()) return;

  const result = await yoloApiService.detectVehicles(
    data.buffer,
    data.cameraId,
    data.track_line_y,
    data.created_at
  );

  if (!result) return;

  // Emit vehicle detection
  if (result.vehicle && result.vehicle.detections.length > 0) {
    const vehiclePayload = {
      camera_id: data.cameraId,
      image_id: data.imageId,
      track_line_y: data.track_line_y,
      detections: result.vehicle.detections,
      inference_time: result.vehicle.inference_time,
      image_dimensions: result.image_dimensions,
      created_at: data.created_at,
      vehicle_count: result.vehicle.vehicle_count,
      tracks: result.vehicle.tracks,
      new_crossings: result.vehicle.new_crossings
    };

    socket.broadcast.emit("car_detected", vehiclePayload);
    socket.emit("car_detected", vehiclePayload);
  }

  // Emit traffic light detection
  if (result.traffic_light && result.traffic_light.traffic_status) {
    const tlPayload = {
      cameraId: data.cameraId,
      imageId: data.imageId,
      traffic_status: result.traffic_light.traffic_status,
      detections: result.traffic_light.detections,
      inference_time: result.traffic_light.inference_time,
      image_dimensions: result.image_dimensions,
      created_at: data.created_at
    };

    socket.broadcast.emit("traffic_light", tlPayload);
    socket.emit("traffic_light", tlPayload);

    // Save to Redis for violation detection
    if (result.traffic_light.traffic_status) {
      let status = "UNKNOWN";
      const raw = result.traffic_light.traffic_status.toUpperCase();
      if (raw.includes("RED")) status = "RED";
      else if (raw.includes("GREEN")) status = "GREEN";
      else if (raw.includes("YELLOW")) status = "YELLOW";
      setTrafficLightStatus(data.cameraId, status);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                      Handle 'traffic_light' event handler                      */
/* -------------------------------------------------------------------------- */
export async function handleTrafficLightEvent(this: Socket, data: any) {
  const socket = this;

  // Sanitize data to prevent Mongoose validation errors
  if (!data.detections) data.detections = [];
  if (!data.inference_time) data.inference_time = 0;
  if (!data.image_dimensions) data.image_dimensions = { width: 640, height: 480 };
  if (data.image_dimensions.width === undefined) data.image_dimensions.width = 0;
  if (data.image_dimensions.height === undefined) data.image_dimensions.height = 0;

  // Clean detections
  data.detections.forEach((d: any) => {
    if (!d.bbox) d.bbox = { x1: 0, y1: 0, x2: 0, y2: 0, width: 0, height: 0 };
    if (d.bbox.width === undefined) d.bbox.width = (d.bbox.x2 || 0) - (d.bbox.x1 || 0);
    if (d.bbox.height === undefined) d.bbox.height = (d.bbox.y2 || 0) - (d.bbox.y1 || 0);
  });

  let maxDetection = { confidence: 0 };
  data.detections.forEach((element: any) => {
    if (maxDetection.confidence < element.confidence) {
      maxDetection = element;
    }
  });

  const payload = {
    cameraId: data.cameraId,
    imageId: data.imageId,
    traffic_status: data.traffic_status,
    detection: maxDetection,
    inference_time: data.inference_time,
    image_dimensions: data.image_dimensions,
    created_at: data.created_at,
  };

  socket.broadcast.emit("traffic_light", payload);
  socket.emit("traffic_light", payload); // Send back to sender

  // Calculate status string (RED, GREEN, YELLOW)
  if (data.traffic_status) {
    let status = "UNKNOWN";
    const raw = data.traffic_status.toUpperCase();
    if (raw.includes("RED")) status = "RED";
    else if (raw.includes("GREEN")) status = "GREEN";
    else if (raw.includes("YELLOW")) status = "YELLOW";

    setTrafficLightStatus(data.cameraId, status);
  }

  console.log("Traffic light detection data", data.traffic_status);

  trafficLightModel.create(data).catch((err) => {
    console.log("Traffic light detection creation failed", err.message);
  });
}


// NOTE: handleCarDetectedEvent đã được xóa vì logic đã được di chuyển sang websocket.service.ts
// Việc gọi socket.broadcast.emit("car_detected") từ đây gây memory leak do circular emit loop


/* -------------------------------------------------------------------------- */
/*                Handle 'violation_license_plate' event handler              */
/* -------------------------------------------------------------------------- */
export async function handleViolationLicensePlateEvent(
  this: Socket,
  data: ViolationLicensePlateDetect
) {
  console.log("Violation license plate data", data);

  /* -------------------------- Handle save violation ------------------------- */
  violationService.saveViolation(data);

  /* -------------------------- Handle save license plate ----------------------- */
  const imageBuffer = await cameraImageModel.findById(data.image_id);
  console.log({ imageBuffer, data });

  if (!imageBuffer) {
    console.error("Image buffer not found for the given image ID");
    return;
  }

  await Promise.all(
    Object.entries(data.license_plates).map(async ([_, license_plate]) => {
      await licensePlateDetectedModel.findOneAndUpdate(
        {
          camera_id: data.camera_id,
          license_plate: license_plate,
        },
        {
          image_buffer: imageBuffer?.image,
        },
        {
          upsert: true,
          new: true,
        }
      );
    })
  );
}