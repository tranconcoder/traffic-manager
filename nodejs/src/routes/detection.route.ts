import { Router, Request, Response } from 'express';
import { bboxStreamManager } from '@/services/bboxStream.service.js';
import { io } from '@/index.js';
import { setTrafficLightStatus } from '@/services/redis.service.js';

const detectionRouter = Router();

/**
 * POST /api/detection/:cameraId
 * Receive detection results from Kaggle AI server
 * Same format as WebSocket handler in kaggleResults.service.ts
 */
detectionRouter.post('/:cameraId', (req: Request, res: Response) => {
    const { cameraId } = req.params;
    const result = req.body;

    // Emit vehicle detection (same format as WebSocket)
    if (result.vehicle && result.vehicle.detections?.length > 0) {
        console.log(`[API] 📸 Rx ${result.vehicle.detections.length} dets for ${cameraId}`);

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

        // DEBUG: Log payload structure
        console.log(`[API] 📡 Emitting 'car_detected':`, JSON.stringify(vehiclePayload.detections[0]));

        // Emit to Socket.IO clients
        io.emit('car_detected', vehiclePayload);

        // Update bbox stream for AI overlay (use bbox_pixels if available)
        const detectionsForBbox = result.vehicle.detections.map((det: any) => ({
            ...det,
            bbox: det.bbox_pixels || det.bbox  // Prefer pixel coords for FFmpeg
        }));
        bboxStreamManager.updateDetections(cameraId, detectionsForBbox);

        // Emit license plates if detected
        const licensePlates: Record<string, string> = {};
        for (const det of result.vehicle.detections) {
            if (det.license_plate && det.id) {
                licensePlates[det.id] = det.license_plate.text;
            }
        }
        if (Object.keys(licensePlates).length > 0) {
            io.emit('license_plate_detected', {
                camera_id: cameraId,
                image_id: result.image_id,
                license_plates: licensePlates,
                created_at: result.created_at || Date.now()
            });
        }
    }

    // Emit traffic light detection
    if (result.traffic_light && result.traffic_light.traffic_status) {
        const tlPayload = {
            cameraId: cameraId,
            imageId: result.image_id,
            traffic_status: result.traffic_light.traffic_status,
            detections: result.traffic_light.detections,
            inference_time: result.traffic_light.inference_time,
            image_dimensions: result.image_dimensions,
            created_at: result.created_at || Date.now()
        };

        io.emit('traffic_light', tlPayload);

        // Save to Redis
        let status = 'UNKNOWN';
        const raw = result.traffic_light.traffic_status.toUpperCase();
        if (raw.includes('RED')) status = 'RED';
        else if (raw.includes('GREEN')) status = 'GREEN';
        else if (raw.includes('YELLOW')) status = 'YELLOW';
        setTrafficLightStatus(cameraId, status);
    }

    res.json({
        success: true,
        vehicleCount: result.vehicle?.detections?.length || 0,
        trafficLight: result.traffic_light?.traffic_status || null
    });
});

/**
 * GET /api/detection/:cameraId
 * Get latest detections for a camera (for debugging)
 */
detectionRouter.get('/:cameraId', (req: Request, res: Response) => {
    const { cameraId } = req.params;
    const detections = bboxStreamManager.getDetections(cameraId);
    res.json({ cameraId, detections });
});

export default detectionRouter;
