import type { Request } from 'express';
import type { WebSocketCustom } from '../types/ws.js';
import { io as ioClient, Socket } from "socket.io-client";

// Websocket
import url from "url";
import { WebSocketServer } from "ws";
// Analytics
import { websocketAnalytics } from "./websocketAnalytics.service.js";
// FFmpeg stream input
import { streamManager } from "./stream.service.js";
import { ffmpegManager } from "./ffmpeg.service.js";
// BBox stream for AI overlay
import { bboxStreamManager } from "./bboxStream.service.js";

// Import the io instance (assuming it's exported from index.ts)
// Adjust the path if necessary
import cameraModel, { CameraModel, cameraSchema } from "@/models/camera.model.js";
import { envConfig } from '@/config/index.js';
import { CAMERA_NAMESPACE_START } from '@/config/socketio.config.js';
import { imageSize } from 'image-size';
import { io } from '@/index.js';
import mongoose from 'mongoose';
import cameraImageModel from '@/models/cameraImage.model.js';
import { pushImage } from '@/services/redis.service.js';

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
      ws.on("message", async function message(data: Buffer | string, isBinary: boolean) {
        // CASE 1: Text/JSON Message (Detection Result from Kaggle)
        // When isBinary is false, it's a text message (JSON from Kaggle)
        if (!isBinary) {
          try {
            const messageStr = data.toString();
            const result = JSON.parse(messageStr);

            console.log({
              result
            })

            // Handle Vehicle Detection
            if (result.vehicle && result.vehicle.detections) {
              console.log(`[WS] 📸 Rx ${result.vehicle.detections.length} dets for ${cameraId}`);

              const vehiclePayload = {
                camera_id: cameraId,
                image_id: result.image_id,
                track_line_y: result.track_line_y || 50,
                detections: result.vehicle.detections,
                inference_time: result.vehicle.inference_time,
                image_dimensions: result.image_dimensions,
                created_at: result.created_at || Date.now(),
                vehicle_count: result.vehicle.vehicle_count,
                tracks: result.vehicle.tracks,
                new_crossings: result.vehicle.new_crossings
              };

              // Emit to Socket.IO clients (Dashboard)
              io.emit('car_detected', vehiclePayload);

              // Update detections for AI overlay
              bboxStreamManager.updateDetections(cameraId, result.vehicle.detections, 'vehicle');
            }

            // Handle Traffic Light Detection
            if (result.traffic_light) {
              const tlPayload = {
                camera_id: cameraId,
                traffic_status: result.traffic_light.traffic_status,
                detections: result.traffic_light.detections || [],
                inference_time: result.traffic_light.inference_time,
                image_dimensions: result.image_dimensions,
                created_at: result.created_at || Date.now()
              };

              // Emit to Socket.IO clients (Dashboard + Node-RED)
              io.emit('traffic_light', tlPayload);

              // Update detections for AI overlay (Overlay traffic lights too)
              if (result.traffic_light.detections && result.traffic_light.detections.length > 0) {
                // Append traffic light detections to existing overlay state if possible, or just overwrite if separate frames?
                // Since they come in different messages, we should probably merge or handle a 'type' update.
                // For now, let's just push them. This might briefly hide cars, but at 25FPS it might flicker/merge visually.
                // To do this right: bboxStreamManager needs to hold separate states for 'vehicle' and 'traffic_light'
                // But simple fix first: Just push them.
                bboxStreamManager.updateDetections(cameraId, result.traffic_light.detections, 'traffic_light');
              }

              // Save to Redis for violation detection
              if (result.traffic_light.traffic_status) {
                const { setTrafficLightStatus } = await import('@/services/redis.service.js');
                let status = 'UNKNOWN';
                const raw = result.traffic_light.traffic_status.toUpperCase();
                if (raw.includes('RED')) status = 'RED';
                else if (raw.includes('GREEN')) status = 'GREEN';
                else if (raw.includes('YELLOW')) status = 'YELLOW';
                await setTrafficLightStatus(cameraId, status);
              }
            }
          } catch (err) {
            console.error('[WS] Error parsing JSON message:', err);
          }
          return;
        }

        // CASE 2: Binary Message (Video Frame from Camera)
        const buffer = data as Buffer; // Cast to Buffer since isBinary is true here

        // Initial frame size check (only once usually)
        if (!width || !height) {
          const dimensions = imageSize(buffer);
          width = dimensions.width;
          height = dimensions.height;

          // Start streams if not already running
          ffmpegManager.startStream(cameraId);
          bboxStreamManager.startAIStream(cameraId);
        }

        websocketAnalytics.transferData(buffer.length, 1)

        const imageId = new mongoose.Types.ObjectId().toString();
        const timestamp = Date.now();

        // Push to FFmpeg stream for RTMP/HLS output
        streamManager.pushData(cameraId, buffer);

        // Push to AI stream with bounding box overlay
        bboxStreamManager.processFrame(cameraId, buffer);

        // 1. Cache to Redis (Every frame - Max FPS)
        pushImage(cameraId, {
          imageId: imageId,
          image: buffer,
          created_at: timestamp,
          width,
          height,
        });

        // 2. Save to MongoDB (1 FPS Throttling)
        const now = Date.now();
        const lastSaved = lastImageSaveTime.get(cameraId) || 0;

        if (now - lastSaved >= 1000) {
          await cameraImageModel.create({
            _id: imageId,
            cameraId,
            image: buffer,
            width,
            height,
            created_at: timestamp,
          });
          lastImageSaveTime.set(cameraId, now);
        }
      });

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

