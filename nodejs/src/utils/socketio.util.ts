import { Socket } from "socket.io";
import trafficLightModel from "@/models/trafficLight.model.js";
import carDetectionModel from "@/models/carDetection.model.js";
import cameraModel from "@/models/camera.model.js";
import violationService from "@/services/violation.service.js";
import trafficStatisticsService from "@/services/trafficStatistics.service.js";
import cameraImageModel from "@/models/cameraImage.model.js";
import { TrafficViolation } from "@/enums/trafficViolation.enum.js";
import { ViolationLicensePlateDetect } from "./socketio.util.d.js";
import imagesModel from "@/models/images.model.js";
import licensePlateDetectedModel from "@/models/licensePlateDetected.model.js";
import sensorDataModel from "@/models/sensorData.model.js";
import { websocketAnalytics } from "@/services/websocketAnalytics.service.js";
import { Types } from "mongoose";
import sharp from "sharp";
import { pushImage, setTrafficLightStatus, getRecentImages } from "@/services/redis.service.js";

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
  car_detected: handleCarDetectedEvent,
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

  socket.broadcast.emit("image", payload);
  socket.emit("image", payload); // Send back to sender

  websocketAnalytics.transferData(data.buffer.length, 1);

  try {
    // 1. Cache to Redis (Every frame - Max FPS)
    // Used for violation context and real-time analysis
    pushImage(data.cameraId, {
      imageId: data.imageId || new Types.ObjectId().toString(),
      image: data.buffer,
      created_at: data.created_at,
      width: data.width,
      height: data.height
    });

    // 2. Save to MongoDB (1 FPS Throttling)
    // Only save if 1 second has passed since last save for this camera
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

  } catch (error: any) {
    console.error("Image autosave/cache failed:", error.message);
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

/* -------------------------------------------------------------------------- */
/*                      Handle 'car_detected' event handler                      */
/* -------------------------------------------------------------------------- */
export async function handleCarDetectedEvent(this: Socket, data: any) {
  const socket = this;

  // Forward vehicle detection data to all clients with original event name
  socket.broadcast.emit("car_detected", data);
  socket.emit("car_detected", data); // Send back to sender

  try {
    const camera = await cameraModel.findById(data.camera_id);
    if (!camera) throw new Error("Not found camera!");

    // Fetch from Redis (using recent 1-minute buffer)
    const recentImages = await getRecentImages(data.camera_id);

    // Find the specific image frame for this detection
    // Try matching by ID first, then fallback to timestamp
    const redisImage = recentImages.find((img: any) =>
      (data.image_id && img.imageId === data.image_id) ||
      (img.created_at === data.created_at)
    );

    let cameraImageBuffer: Buffer | null = null;
    if (!redisImage) {
      console.warn(`[Car Detection] Image frame not found in Redis cache (ID: ${data.image_id}). Proceeding without image buffer.`);
    } else {
      // Restore Buffer
      if (redisImage.image && redisImage.image.type === 'Buffer') {
        cameraImageBuffer = Buffer.from(redisImage.image.data);
      } else if (Array.isArray(redisImage.image?.data)) {
        cameraImageBuffer = Buffer.from(redisImage.image.data);
      } else if (redisImage.image) {
        cameraImageBuffer = Buffer.from(redisImage.image);
      }
    }

    // Detect Red Light Violations (Optimized to check Redis for traffic light)
    const redLightViolations = await violationService.detectRedLightViolation(
      data,
      camera
    );

    // Detect Lane Encroachment
    const laneViolations = await violationService.laneEncroachment(
      data.detections,
      data.image_dimensions,
      camera
    );

    const carDetectionResult = await carDetectionModel
      .create({
        camera_id: data.camera_id,
        image_id: data.image_id,
        created_at: data.created_at,
        detections: data.detections,
        inference_time: data.inference_time,
        image_dimensions: data.image_dimensions,
        vehicle_count: data.vehicle_count,
        tracks: data.tracks,
        new_crossings: data.new_crossings,
      })
      .catch((error) => {
        console.error("[Car Detection] Error creating record:", error);
        return null;
      });

    // Process violations if any
    const violations = [
      ...redLightViolations.map((id) => ({
        id,
        type: TrafficViolation.RED_LIGHT_VIOLATION,
      })),
      ...laneViolations.map((id) => ({
        id,
        type: TrafficViolation.LANE_ENCROACHMENT,
      })),
    ];

    if (violations.length > 0) {
      socket.broadcast.emit("violation_detect", {
        camera_id: data.camera_id,
        image_id: data.image_id,
        violations,
        buffer: cameraImageBuffer, // Send the high-quality buffer from Redis
        detections: data.detections,
      });
    }

    if (carDetectionResult)
      console.log("[Car Detection] Record created successfully");
    if (violations.length > 0)
      console.log(`[Violations] Detected ${violations.length} violations`);
  } catch (error: any) {
    console.error("[Car Detection] Error processing event:", error);
  }
}

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