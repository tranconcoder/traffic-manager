import type { Request } from 'express';
import type { WebSocketCustom } from '../types/ws.js';

// Websocket
import url from "url";
import { WebSocketServer } from "ws";
// Analytics
import { websocketAnalytics } from "./websocketAnalytics.service.js";
// FFmpeg stream input
import { ffmpegManager } from "./ffmpeg.service.js";
import { streamManager } from "./stream.service.js";
// BBox stream for AI overlay
import { bboxStreamManager } from "./bboxStream.service.js";

// Import the io instance (assuming it's exported from index.ts)
// Adjust the path if necessary
import { TrafficViolation } from '@/enums/trafficViolation.enum.js';
import { io } from '@/index.js';
import cameraModel from "@/models/camera.model.js";
import cameraImageModel from '@/models/cameraImage.model.js';
import carDetectionModel from "@/models/carDetection.model.js";
import trafficStatisticsModel from "@/models/trafficStatistics.model.js";
import { getRecentImages, pushImage } from '@/services/redis.service.js';
import violationService from '@/services/violation.service.js';
import { imageSize } from 'image-size';
import mongoose from 'mongoose';

// Rate limiting map for 1FPS MongoDB saving
const lastImageSaveTime = new Map<string, number>();

export default function runWebsocketService(
  wss: WebSocketServer,
  HOST: string,
  PORT: number
) {
  wss.on(
    "connection",
    async function connection(ws: WebSocketCustom, req: Request) {
      console.log(`[WS] Incoming connection: ${req.url}`);
      // Validate connection
      const query = url.parse(req.url, true).query;
      const cameraId = query.cameraId as string;
      const apiKey = query.apiKey as string;

      /* -------------------------------------------------------------------------- */
      /*                               Validate header                              */
      /* -------------------------------------------------------------------------- */
      /* ------------------------ Check cameraId and apiKey ----------------------- */
      if (!cameraId || !apiKey) return ws.close();

      /* -------------------------- Check camera is valid ------------------------- */
      const camera = await cameraModel.findOne({
        _id: cameraId,
        camera_api_key: apiKey,
      });
      if (!camera) return ws.close();


      ws.id = cameraId;

      console.log(`[WS] Client connected for camera: ${cameraId.slice(-4)}`);

      ws.on("error", console.error);

      let width: number;
      let height: number;

      ws.once("message", async function message(data: Buffer | string, isBinary: boolean) {
        if (isBinary) {
          bboxStreamManager.startAIStream(cameraId);
        }
      })

      /* ----------------------------- Handle message ----------------------------- */

      /**
       * Helper function để lấy image buffer từ Redis cache
       * @param cameraId - ID của camera
       * @param imageId - ID của ảnh cần tìm
       * @param createdAt - Timestamp khi ảnh được tạo (fallback)
       * @returns Buffer của ảnh hoặc null nếu không tìm thấy
       */
      async function getImageBufferFromRedis(cameraId: string, imageId: string | undefined, createdAt: number): Promise<Buffer | null> {
        console.log(`[WS][DEBUG] Getting image buffer from Redis for camera: ${cameraId.slice(-4)}, imageId: ${imageId}`);

        const recentImages = await getRecentImages(cameraId);
        console.log(`[WS][DEBUG] Found ${recentImages.length} recent images in Redis cache`);

        // Find the specific image frame for this detection
        // Try matching by ID first, then fallback to timestamp
        const redisImage = recentImages.find((img: any) =>
          (imageId && img.imageId === imageId) ||
          (img.created_at === createdAt)
        );

        if (!redisImage) {
          console.warn(`[WS][DEBUG] Image frame not found in Redis cache (ID: ${imageId})`);
          return null;
        }

        console.log(`[WS][DEBUG] Found image in Redis, type: ${typeof redisImage.image}`);

        // Restore Buffer from Redis data
        if (redisImage.image && redisImage.image.type === 'Buffer') {
          return Buffer.from(redisImage.image.data);
        } else if (Array.isArray(redisImage.image?.data)) {
          return Buffer.from(redisImage.image.data);
        } else if (redisImage.image) {
          return Buffer.from(redisImage.image);
        }

        return null;
      }

      async function onKaggleDetectResponse(data: Buffer | string) {
        try {
          // Parse JSON
          const messageStr = data.toString();
          const result = JSON.parse(messageStr);
          console.log(`[WS][DEBUG] Received Kaggle response for camera: ${cameraId.slice(-4)}`);

          // 1. Vehicle Detection
          if (result.vehicle && result.vehicle.detections) {
            console.log(`[WS][DEBUG] Processing vehicle detection: ${result.vehicle.detections.length} detections`);

            const vehiclePayload = {
              camera_id: cameraId,
              image_id: result.image_id,
              track_line_y: result.track_line_y || 50,
              counting_line: result.track_line_y || 50,
              detections: result.vehicle.detections,
              inference_time: result.vehicle.inference_time,
              image_dimensions: result.image_dimensions,
              created_at: result.created_at || Date.now(),
              vehicle_count: result.vehicle.vehicle_count,
              tracks: result.vehicle.tracks,
              new_crossings: result.vehicle.new_crossings
            };

            /* ========================================================================== */
            /*                    INLINED FROM socketio.util.ts                           */
            /*                    handleCarDetectedEvent logic                            */
            /* ========================================================================== */

            // Emit car_detected event directly to Socket.IO clients
            // NOTE: Không gọi lại socketio handler, emit trực tiếp đến clients
            io.emit('car_detected', vehiclePayload);
            console.log(`[WS][DEBUG] Emitted 'car_detected' to Socket.IO clients (camera: ${cameraId.slice(-4)})`);

            // Camera đã được validate ở connection, sử dụng lại biến camera
            // Không cần query DB lại như trong socketio.util.ts

            // Get image buffer from Redis for violation detection
            const cameraImageBuffer = await getImageBufferFromRedis(
              cameraId,
              vehiclePayload.image_id,
              vehiclePayload.created_at
            );

            // Detect Red Light Violations (check Redis for traffic light status)
            console.log(`[WS][DEBUG] Detecting red light violations...`);
            const redLightViolations = await violationService.detectRedLightViolation(
              vehiclePayload,
              camera! // camera đã được validate ở connection (line 56)
            );
            console.log(`[WS][DEBUG] Red light violations: ${redLightViolations.length}`);

            // Detect Lane Encroachment
            console.log(`[WS][DEBUG] Detecting lane encroachment...`);
            const laneViolations = await violationService.laneEncroachment(
              vehiclePayload.detections,
              vehiclePayload.image_dimensions,
              camera! // camera đã được validate ở connection (line 56)
            );
            console.log(`[WS][DEBUG] Lane violations: ${laneViolations.length}`);

            // Save car detection to MongoDB (async, don't await to not block)
            carDetectionModel.create({
              camera_id: vehiclePayload.camera_id,
              image_id: vehiclePayload.image_id,
              created_at: vehiclePayload.created_at,
              detections: vehiclePayload.detections,
              inference_time: vehiclePayload.inference_time,
              image_dimensions: vehiclePayload.image_dimensions,
              vehicle_count: vehiclePayload.vehicle_count,
              tracks: vehiclePayload.tracks,
              new_crossings: vehiclePayload.new_crossings,
            }).then(() => {
              console.log(`[WS][DEBUG] Car detection record created successfully (camera: ${cameraId.slice(-4)})`);
            }).catch((error) => {
              console.error(`[WS][ERROR] Error creating car detection record:`, error);
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
              // Emit violation_detect event directly to Socket.IO clients
              io.emit('violation_detect', {
                camera_id: vehiclePayload.camera_id,
                image_id: vehiclePayload.image_id,
                violations,
                buffer: cameraImageBuffer, // High-quality buffer from Redis
                detections: vehiclePayload.detections,
              });
              console.log(`[WS][DEBUG] Emitted 'violation_detect': ${violations.length} violations (camera: ${cameraId.slice(-4)})`);
            }

            /* ========================================================================== */
            /*                    END INLINED FROM socketio.util.ts                       */
            /* ========================================================================== */

            // Update Overlay
            bboxStreamManager.updateDetections(cameraId, result.vehicle.detections, 'vehicle');

            // 3. Realtime Traffic Statistics Update
            // Khi có xe mới qua đường (new_crossings), increment thống kê ngay lập tức
            const newCrossings = result.vehicle.new_crossings || [];
            if (newCrossings.length > 0) {
              console.log(`[WS][DEBUG] Processing ${newCrossings.length} new crossings for statistics`);
              const tracks = result.vehicle.tracks || [];

              // Đếm số lượng xe theo loại từ new_crossings
              const vehicleTypeCounts: Record<string, number> = {
                car: 0, truck: 0, bus: 0, motorcycle: 0, bicycle: 0
              };

              newCrossings.forEach((crossing: { id: string; direction: string }) => {
                // Tìm loại xe từ tracks dựa vào id
                const track = tracks.find((t: { id: number; class: string }) =>
                  String(t.id) === String(crossing.id)
                );
                if (track && track.class) {
                  const vehicleClass = track.class.toLowerCase();
                  if (vehicleTypeCounts.hasOwnProperty(vehicleClass)) {
                    vehicleTypeCounts[vehicleClass]++;
                  }
                }
              });

              const totalNewVehicles = Object.values(vehicleTypeCounts).reduce((a, b) => a + b, 0);

              if (totalNewVehicles > 0) {
                const now = new Date();
                const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const minuteOfDay = now.getHours() * 60 + now.getMinutes();

                // Upsert: tăng vehicle_count và vehicle_types theo ngày + phút
                await trafficStatisticsModel.findOneAndUpdate(
                  {
                    camera_id: cameraId,
                    date: todayStart,
                    minute_of_day: minuteOfDay,
                  },
                  {
                    $inc: {
                      vehicle_count: totalNewVehicles,
                      'vehicle_types.car': vehicleTypeCounts.car,
                      'vehicle_types.truck': vehicleTypeCounts.truck,
                      'vehicle_types.bus': vehicleTypeCounts.bus,
                      'vehicle_types.motorcycle': vehicleTypeCounts.motorcycle,
                    },
                  },
                  { upsert: true, new: true }
                ).catch(err => console.error('[WS][ERROR] Error updating traffic statistics:', err));

                // Emit Socket.IO event để Node-RED nhận được cập nhật realtime
                io.emit('traffic_stats_update', {
                  camera_id: cameraId,
                  new_vehicles: totalNewVehicles,
                  vehicle_types: vehicleTypeCounts,
                  timestamp: Date.now(),
                });

                console.log(`[WS][DEBUG] Traffic stats updated: +${totalNewVehicles} vehicles (camera: ${cameraId.slice(-4)}, minute: ${minuteOfDay})`);
              }
            }
          }

          // 2. Traffic Light Detection
          if (result.traffic_light) {
            // ... (keep existing traffic light logic or refactor similarly if needed) ...
            // For now keeping it as is but ensuring no duplicate emits if possible.
            // The previous code had manual emit.

            let status = 'UNKNOWN';
            const raw = (result.traffic_light.traffic_status || "").toUpperCase();
            if (raw.includes('RED')) status = 'RED';
            else if (raw.includes('GREEN')) status = 'GREEN';
            else if (raw.includes('YELLOW')) status = 'YELLOW';
            else if (result.traffic_light.traffic_status) status = result.traffic_light.traffic_status;

            const tlPayload = {
              camera_id: cameraId,
              traffic_status: status,
              detections: result.traffic_light.detections || [],
              inference_time: result.traffic_light.inference_time,
              image_dimensions: result.image_dimensions,
              created_at: result.created_at || Date.now()
            };

            io.emit('traffic_light', tlPayload);

            if (result.traffic_light.detections && result.traffic_light.detections.length > 0) {
              bboxStreamManager.updateDetections(cameraId, result.traffic_light.detections, 'traffic_light');
            }

            if (status !== 'UNKNOWN') {
              const { setTrafficLightStatus } = await import('@/services/redis.service.js');
              await setTrafficLightStatus(cameraId, status);
            }
          }

        } catch (err) {
          console.error('[WS] Error parsing AI message:', err);
        }
      }

      async function onCameraImage(data: Buffer) {
        // Initial sizing check
        if (!width || !height) {
          const dimensions = imageSize(data);
          width = dimensions.width;
          height = dimensions.height;

          ffmpegManager.startStream(cameraId);
          bboxStreamManager.startAIStream(cameraId);
        }

        websocketAnalytics.transferData(data.length, 1);

        const imageId = new mongoose.Types.ObjectId().toString();
        const timestamp = Date.now();

        streamManager.pushData(cameraId, data);
        bboxStreamManager.processFrame(cameraId, data);

        pushImage(cameraId, {
          imageId: imageId,
          image: data,
          created_at: timestamp,
          width,
          height,
        });

        // MongoDB Throttling (1 FPS)
        const now = Date.now();
        const lastSaved = lastImageSaveTime.get(cameraId) || 0;
        if (now - lastSaved >= 1000) {
          // async save (don't await to block)
          cameraImageModel.create({
            _id: imageId,
            cameraId,
            image: data,
            width,
            height,
            created_at: timestamp,
          }).catch(e => console.error(e));

          lastImageSaveTime.set(cameraId, now);
        }
      }

      // Dispatcher: Route raw 'message' to specific events
      ws.on("message", async function message(data: Buffer | string, isBinary: boolean) {
        if (isBinary) {
          ws.emit('cameraImage', data);
        } else {
          ws.emit('kaggleDetectResponse', data);
        }
      });

      // Register specific handlers (cleaner separation as requested)
      ws.on('cameraImage', onCameraImage);
      ws.on('kaggleDetectResponse', onKaggleDetectResponse);

    }
  );

  wss.on("listening", () => {
    console.log(`WebSocket Server is listening on ws://${HOST}:${PORT}`);
  });

  wss.on("error", console.log);

  wss.on("close", () => {
    console.log("Websocket is closed!");
  });
}

