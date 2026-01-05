import type { Request } from 'express';
import type { WebSocketCustom } from '../types/ws.js';

import url from "url";
import { WebSocketServer } from "ws";

// Analytics
import { websocketAnalytics } from "./websocketAnalytics.service.js";
// FFmpeg stream input
import { ffmpegManager } from "./ffmpeg.service.js";
import { streamManager } from "./stream.service.js";
// BBox stream for AI overlay
import { bboxStreamManager } from "./bboxStream.service.js";

import cameraModel from "@/models/camera.model.js";
import cameraImageModel from '@/models/cameraImage.model.js';
import { imageSize } from 'image-size';
import mongoose from 'mongoose';

// Rate limiting map for 1FPS MongoDB saving
const lastImageSaveTime = new Map<string, number>();

/**
 * Camera WebSocket Service (V2)
 * Path: /ws/camera
 * 
 * Chức năng:
 * - Nhận binary frames từ camera (Python client)
 * - Push vào FFmpeg stream (HLS)
 * - Update BBox overlay
 * - KHÔNG lưu Redis cache (tiết kiệm RAM)
 * - KHÔNG xử lý AI detection (Kaggle xử lý riêng)
 */
export default function runCameraWsService(wss: WebSocketServer) {
    console.log('[CameraWS] Service initialized on path /ws/camera');

    wss.on(
        "connection",
        async function connection(ws: WebSocketCustom, req: Request) {
            console.log(`[CameraWS] Incoming connection: ${req.url}`);

            // Validate connection
            const query = url.parse(req.url, true).query;
            const cameraId = query.cameraId as string;
            const apiKey = query.apiKey as string;

            /* -------------------------------------------------------------------------- */
            /*                               Validate header                              */
            /* -------------------------------------------------------------------------- */
            if (!cameraId || !apiKey) {
                console.log(`[CameraWS][DEBUG] Missing cameraId or apiKey, closing connection`);
                return ws.close();
            }

            /* -------------------------- Check camera is valid ------------------------- */
            const camera = await cameraModel.findOne({
                _id: cameraId,
                camera_api_key: apiKey,
            });

            if (!camera) {
                console.log(`[CameraWS][DEBUG] Invalid camera credentials for cameraId: ${cameraId}`);
                return ws.close();
            }

            ws.id = cameraId;
            console.log(`[CameraWS] Client connected for camera: ${cameraId.slice(-4)}`);

            ws.on("error", (err) => {
                console.error(`[CameraWS][ERROR] WebSocket error for camera ${cameraId.slice(-4)}:`, err);
            });

            let width: number;
            let height: number;

            // Start streams on first message
            ws.once("message", async function message(data: Buffer | string, isBinary: boolean) {
                if (isBinary) {
                    console.log(`[CameraWS][DEBUG] First binary frame received, starting AI stream for camera: ${cameraId.slice(-4)}`);
                    bboxStreamManager.startAIStream(cameraId);
                }
            });

            /* ----------------------------- Handle message ----------------------------- */

            async function onCameraImage(data: Buffer) {
                // Initial sizing check
                if (!width || !height) {
                    const dimensions = imageSize(data);
                    width = dimensions.width;
                    height = dimensions.height;

                    console.log(`[CameraWS][DEBUG] Image dimensions detected: ${width}x${height} for camera: ${cameraId.slice(-4)}`);
                    ffmpegManager.startStream(cameraId);
                    bboxStreamManager.startAIStream(cameraId);
                }

                websocketAnalytics.transferData(data.length, 1);

                const imageId = new mongoose.Types.ObjectId().toString();
                const timestamp = Date.now();

                // Push to FFmpeg Stream
                streamManager.pushData(cameraId, data);
                bboxStreamManager.processFrame(cameraId, data);

                // NOTE: Không push vào Redis để tiết kiệm RAM
                // Kaggle version mới sẽ detect và gửi kết quả trực tiếp

                // MongoDB Throttling (1 FPS) - chỉ lưu để archive
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
                    }).catch(e => console.error(`[CameraWS][ERROR] Error saving image:`, e));

                    lastImageSaveTime.set(cameraId, now);
                    console.log(`[CameraWS][DEBUG] Saved image to MongoDB (1 FPS throttle) for camera: ${cameraId.slice(-4)}`);
                }
            }

            // Handle incoming messages
            ws.on("message", async function message(data: Buffer | string, isBinary: boolean) {
                if (isBinary) {
                    await onCameraImage(data as Buffer);
                } else {
                    // Ignore non-binary messages in camera WS
                    console.log(`[CameraWS][DEBUG] Ignoring non-binary message from camera: ${cameraId.slice(-4)}`);
                }
            });

            ws.on("close", () => {
                console.log(`[CameraWS] Client disconnected for camera: ${cameraId.slice(-4)}`);
            });
        }
    );

    wss.on("error", (err) => {
        console.error('[CameraWS][ERROR] WebSocket server error:', err);
    });
}
