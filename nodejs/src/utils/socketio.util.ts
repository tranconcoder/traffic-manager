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

  socket.broadcast.emit("image", {
    cameraId: data.cameraId,
    imageId: data.imageId,
    width: data.width,
    height: data.height,
    buffer: data.buffer,
    created_at: data.created_at,
    track_line_y: data.track_line_y,
  });
}

/* -------------------------------------------------------------------------- */
/*                      Handle 'traffic_light' event handler                      */
/* -------------------------------------------------------------------------- */
export async function handleTrafficLightEvent(this: Socket, data: any) {
  const socket = this;

  let maxDetection = { confidence: 0 };
  data.detections.forEach((element: any) => {
    if (maxDetection.confidence < element.confidence) {
      maxDetection = element;
    }
  });

  socket.broadcast.emit("traffic_light", {
    cameraId: data.cameraId,
    imageId: data.imageId,
    traffic_status: data.traffic_status,
    detection: maxDetection,
    inference_time: data.inference_time,
    image_dimensions: data.image_dimensions,
    created_at: data.created_at,
  });

  console.log("Traffic light detection data", data.traffic_status);

  trafficLightModel.create(data).catch((err) => {
    console.log("Traffic light detection creation failed", err);
  });
}

/* -------------------------------------------------------------------------- */
/*                      Handle 'car_detected' event handler                      */
/* -------------------------------------------------------------------------- */
export async function handleCarDetectedEvent(this: Socket, data: any) {
  const socket = this;

  // Forward vehicle detection data to all clients with original event name
  socket.broadcast.emit("car_detected", data);

  try {
    // Parallel fetch camera and image buffer
    const [camera, imageBuffer] = await Promise.all([
      cameraModel.findById(data.camera_id),
      cameraImageModel.findById(data.image_id),
    ]);

    if (!camera) throw new Error("Not found camera!");
    if (!imageBuffer) throw new Error("Not found image buffer!");

    const redLightViolations = await violationService.detectRedLightViolation(
      data,
      camera
    );
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
        buffer: imageBuffer.image,
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
