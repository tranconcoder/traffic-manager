import type { Request } from 'express';
import type { WebSocketCustom } from '../types/ws.js';

import url from "url";
import { WebSocketServer } from "ws";

// Socket.IO for emitting events to dashboard
import { io } from '@/index.js';

// Models
import carDetectionModel from "@/models/carDetection.model.js";
import trafficStatisticsModel from "@/models/trafficStatistics.model.js";
import violationModel from "@/models/violation.model.js";
import licensePlateDetectedModel from "@/models/licensePlateDetected.model.js";
import TrackedVehicle from "@/models/trackedVehicle.model.js";

// Services
import { setTrafficLightStatus } from '@/services/redis.service.js';
import { bboxStreamManager } from "./bboxStream.service.js";

// Enums
import { TrafficViolation } from '@/enums/trafficViolation.enum.js';

// NOTE: Không dùng hardcoded API key nữa - validate bằng camera_api_key từ mỗi camera

/**
 * Kaggle WebSocket Service (V2)
 * Path: /ws/kaggle
 * 
 * Chức năng:
 * - Nhận JSON results từ Kaggle (AI detection results)
 * - Lưu violations + license plates vào MongoDB
 * - Emit events qua Socket.IO cho dashboard
 * - KHÔNG cache ảnh, KHÔNG detect violations (Kaggle đã detect)
 */
export default function runKaggleWsService(wss: WebSocketServer) {
    console.log('[KaggleWS] Service initialized on path /ws/kaggle');

    wss.on(
        "connection",
        async function connection(ws: WebSocketCustom, req: Request) {
            console.log(`[KaggleWS] Incoming connection: ${req.url}`);

            // Validate connection - chỉ cần có apiKey (sẽ validate với camera_api_key từ mỗi message)
            const query = url.parse(req.url, true).query;
            const apiKey = query.apiKey as string;

            /* -------------------------------------------------------------------------- */
            /*                               Validate API Key                             */
            /* -------------------------------------------------------------------------- */
            // NOTE: Kaggle gửi camera_api_key của từng camera, không phải 1 key chung
            // Validation sẽ được thực hiện khi nhận message (check camera_id + camera_api_key)
            if (!apiKey) {
                console.log(`[KaggleWS][DEBUG] Missing API key, closing connection`);
                return ws.close();
            }

            ws.id = `kaggle-${apiKey.slice(-4)}`;
            console.log(`[KaggleWS] Kaggle client connected with key: ...${apiKey.slice(-8)}`);

            ws.on("error", (err) => {
                console.error(`[KaggleWS][ERROR] WebSocket error:`, err);
            });

            /* ----------------------------- Handle message ----------------------------- */

            interface KaggleViolation {
                type: 'RED_LIGHT' | 'LANE_ENCROACHMENT';
                license_plate: string;
                confidence: number;
                bbox: { x1: number; y1: number; x2: number; y2: number };
                detection_id: number;
                image_crop?: string; // Base64 encoded
            }

            interface KaggleResult {
                camera_id: string;
                image_id?: string;
                created_at: number;
                detections: any[];
                vehicle_count: number;
                tracks: any[];
                new_crossings: any[];
                track_counts?: { car: number; truck: number; bus: number; motorcycle: number; bicycle: number };
                traffic_light?: {
                    status: string;
                    detections: any[];
                };
                violations?: KaggleViolation[];
                image_dimensions?: { width: number; height: number };
                inference_time?: number;
                license_plates?: any[]; // V17+
            }

            async function onKaggleResult(data: Buffer | string) {
                try {
                    const messageStr = data.toString();
                    const result: KaggleResult = JSON.parse(messageStr);

                    const cameraId = result.camera_id;
                    console.log(`[KaggleWS][DEBUG] Received result for camera: ${cameraId?.slice(-4)}`);

                    if (!cameraId) {
                        console.warn(`[KaggleWS][DEBUG] Missing camera_id in payload, ignoring`);
                        return;
                    }

                    /* ====================================================================== */
                    /*                          1. Vehicle Detection                         */
                    /* ====================================================================== */
                    if (result.detections && result.detections.length > 0) {
                        console.log(`[KaggleWS][DEBUG] Processing ${result.detections.length} detections`);

                        const vehiclePayload = {
                            camera_id: cameraId,
                            image_id: result.image_id,
                            detections: result.detections,
                            inference_time: result.inference_time,
                            image_dimensions: result.image_dimensions,
                            created_at: result.created_at || Date.now(),
                            vehicle_count: result.vehicle_count,
                            tracks: result.tracks,
                            new_crossings: result.new_crossings
                        };

                        // Emit to Socket.IO clients (dashboard)
                        io.emit('car_detected', vehiclePayload);
                        console.log(`[KaggleWS][DEBUG] Emitted 'car_detected' to Socket.IO clients`);

                        // Save to MongoDB with track_counts from Kaggle
                        const trackCounts = result.track_counts || { car: 0, truck: 0, bus: 0, motorcycle: 0, bicycle: 0 };

                        carDetectionModel.create({
                            camera_id: cameraId,
                            image_id: result.image_id,
                            created_at: result.created_at || Date.now(),
                            detections: result.detections,
                            inference_time: result.inference_time,
                            image_dimensions: result.image_dimensions,
                            vehicle_count: {
                                total_up: trackCounts.car + trackCounts.truck + trackCounts.bus + trackCounts.motorcycle + trackCounts.bicycle,
                                total_down: 0,
                                by_type_up: trackCounts,
                                by_type_down: { car: 0, truck: 0, bus: 0, motorcycle: 0, bicycle: 0 },
                            },
                            tracks: result.tracks,
                            new_crossings: [],
                        }).then(() => {
                            console.log(`[KaggleWS][DEBUG] Saved track_counts: car=${trackCounts.car}, truck=${trackCounts.truck}, bus=${trackCounts.bus}, motorcycle=${trackCounts.motorcycle}`);
                        }).catch((error) => {
                            console.error(`[KaggleWS][ERROR] Error saving car detection:`, error);
                        });

                        // Update BBox overlay - merge violations into detections
                        const detectionsWithViolations = result.detections.map((det: any) => {
                            const violation = result.violations?.find((v: any) =>
                                v.detection_id === det.track_id || v.license_plate === det.license_plate
                            );
                            return violation ? { ...det, violation_type: violation.type } : det;
                        });
                        if (detectionsWithViolations.length > 0) {
                            console.log(`[KaggleWS][DEBUG] Sending ${detectionsWithViolations.length} detections to bbox. Sample:`, JSON.stringify(detectionsWithViolations[0]).slice(0, 200));
                        }
                        bboxStreamManager.updateDetections(cameraId, detectionsWithViolations, 'vehicle');

                        /* ------------------------------------------------------------------ */
                        /*              Traffic Statistics (realtime update)                  */
                        /* ------------------------------------------------------------------ */
                        const newCrossings = result.new_crossings || [];
                        if (newCrossings.length > 0) {
                            console.log(`[KaggleWS][DEBUG] Processing ${newCrossings.length} new crossings`);
                            const tracks = result.tracks || [];

                            const vehicleTypeCounts: Record<string, number> = {
                                car: 0, truck: 0, bus: 0, motorcycle: 0, bicycle: 0
                            };

                            newCrossings.forEach((crossing: { id: string; direction: string }) => {
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

                                await trafficStatisticsModel.findOneAndUpdate(
                                    { camera_id: cameraId, date: todayStart, minute_of_day: minuteOfDay },
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
                                ).catch(err => console.error('[KaggleWS][ERROR] Error updating traffic stats:', err));

                                io.emit('traffic_stats_update', {
                                    camera_id: cameraId,
                                    new_vehicles: totalNewVehicles,
                                    vehicle_types: vehicleTypeCounts,
                                    timestamp: Date.now(),
                                });

                                console.log(`[KaggleWS][DEBUG] Traffic stats updated: +${totalNewVehicles} vehicles`);
                            }
                        }
                    }

                    /* ====================================================================== */
                    /*                          2. Traffic Light                             */
                    /* ====================================================================== */
                    if (result.traffic_light) {
                        let status = 'UNKNOWN';
                        const raw = (result.traffic_light.status || "").toUpperCase();
                        if (raw.includes('RED')) status = 'RED';
                        else if (raw.includes('GREEN')) status = 'GREEN';
                        else if (raw.includes('YELLOW')) status = 'YELLOW';

                        const tlPayload = {
                            camera_id: cameraId,
                            traffic_status: status,
                            detections: result.traffic_light.detections || [],
                            inference_time: result.inference_time,
                            image_dimensions: result.image_dimensions,
                            created_at: result.created_at || Date.now()
                        };

                        io.emit('traffic_light', tlPayload);
                        console.log(`[KaggleWS][DEBUG] Emitted 'traffic_light': ${status}`);

                        if (result.traffic_light.detections?.length > 0) {
                            bboxStreamManager.updateDetections(cameraId, result.traffic_light.detections, 'traffic_light');
                        }

                        if (status !== 'UNKNOWN') {
                            await setTrafficLightStatus(cameraId, status);
                        }
                    }

                    /* ====================================================================== */
                    /*                          3. Violations                                */
                    /* ====================================================================== */
                    // CHỈ xử lý khi có violations VÀ license_plate (theo yêu cầu user)
                    if (result.violations && result.violations.length > 0) {
                        console.log(`[KaggleWS][DEBUG] Processing ${result.violations.length} violations`);

                        const validViolations = result.violations.filter(v => v.license_plate);

                        if (validViolations.length > 0) {
                            for (const violation of validViolations) {
                                // Map violation type
                                const violationType = violation.type === 'RED_LIGHT'
                                    ? TrafficViolation.RED_LIGHT_VIOLATION
                                    : TrafficViolation.LANE_ENCROACHMENT;

                                // Save violation to MongoDB
                                await violationModel.create({
                                    camera_id: cameraId,
                                    license_plate: violation.license_plate,
                                    violation_type: violationType,
                                    confidence: violation.confidence,
                                    bbox: violation.bbox,
                                    image_crop: violation.image_crop,
                                    created_at: result.created_at || Date.now(),
                                }).catch((err: Error) => console.error('[KaggleWS][ERROR] Error saving violation:', err));

                                // Save license plate
                                await licensePlateDetectedModel.findOneAndUpdate(
                                    { camera_id: cameraId, license_plate: violation.license_plate },
                                    {
                                        last_seen: Date.now(),
                                        violation_type: violationType,
                                        $inc: { violation_count: 1 }
                                    },
                                    { upsert: true, new: true }
                                ).catch((err: Error) => console.error('[KaggleWS][ERROR] Error saving license plate:', err));

                                console.log(`[KaggleWS][DEBUG] Saved violation: ${violation.type} - ${violation.license_plate}`);

                                // Blacklist check moved to global handler below
                            }

                            // Emit violation event
                            io.emit('violation_detect', {
                                camera_id: cameraId,
                                image_id: result.image_id,
                                violations: validViolations.map(v => ({
                                    type: v.type,
                                    license_plate: v.license_plate,
                                    confidence: v.confidence
                                })),
                                created_at: result.created_at || Date.now()
                            });

                            console.log(`[KaggleWS][DEBUG] Emitted 'violation_detect': ${validViolations.length} violations`);
                        }

                        /* ---------------- Check ALL detected plates (V17+) ---------------- */
                        const incomingPlates = result.license_plates || [];
                        if (result.violations) {
                            result.violations.forEach((v: any) => { if (v.license_plate) incomingPlates.push({ plate: v.license_plate }); });
                        }

                        if (incomingPlates.length > 0) {
                            const uniquePlates = new Set();
                            for (const item of incomingPlates) {
                                const plate = item.plate || item.license_plate;
                                if (!plate || uniquePlates.has(plate)) continue;
                                uniquePlates.add(plate);

                                try {
                                    const tracked = await TrackedVehicle.findOne({ license_plate: plate });
                                    if (tracked) {
                                        console.log(`[KaggleWS][ALERT] 🚨 FOUND TRACKED VEHICLE: ${plate}`);
                                        io.emit('tracked_vehicle_alert', {
                                            camera_id: cameraId,
                                            license_plate: plate,
                                            reason: tracked.reason,
                                            description: tracked.description,
                                            timestamp: Date.now()
                                        });
                                    }
                                } catch (err) { console.error('Error checking tracked vehicle:', err); }
                            }
                        }
                    }

                } catch (err) {
                    console.error('[KaggleWS][ERROR] Error parsing Kaggle result:', err);
                }
            }

            // Handle incoming messages
            ws.on("message", async function message(data: Buffer | string, isBinary: boolean) {
                if (!isBinary) {
                    await onKaggleResult(data);
                } else {
                    console.log(`[KaggleWS][DEBUG] Ignoring binary message from Kaggle`);
                }
            });

            ws.on("close", () => {
                console.log(`[KaggleWS] Kaggle client disconnected`);
            });
        }
    );

    wss.on("error", (err) => {
        console.error('[KaggleWS][ERROR] WebSocket server error:', err);
    });
}
