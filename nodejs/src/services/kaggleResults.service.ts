/**
 * WebSocket Server for receiving Kaggle detection results
 * 
 * Kaggle connects and sends detection results
 * Backend emits car_detected, traffic_light events to Socket.IO clients
 */

import { WebSocketServer, WebSocket, RawData } from 'ws';
import { io } from '@/index.js';
import { setTrafficLightStatus } from '@/services/redis.service.js';

let wss: WebSocketServer | null = null;
let connectedClients = 0;
let totalResults = 0;

export function createKaggleResultsServer(port: number = 3002): WebSocketServer {
    wss = new WebSocketServer({ port });

    wss.on('connection', (ws: WebSocket) => {
        connectedClients++;
        console.log(`[Kaggle Results] Client connected (${connectedClients} total)`);

        ws.on('message', (data: RawData) => {
            try {
                const message = JSON.parse(data.toString());

                if (message.type === 'detection_result' && message.data) {
                    handleDetectionResult(message.data);
                }
            } catch (err: any) {
                console.error('[Kaggle Results] Parse error:', err.message);
            }
        });

        ws.on('close', () => {
            connectedClients--;
            console.log(`[Kaggle Results] Client disconnected (${connectedClients} remaining)`);
        });

        ws.on('error', (err) => {
            console.error('[Kaggle Results] Error:', err.message);
        });

        // Send welcome
        ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to Kaggle Results Server' }));
    });

    wss.on('listening', () => {
        console.log('═'.repeat(60));
        console.log(`[Kaggle Results] WebSocket server on ws://0.0.0.0:${port}`);
        console.log(`[Kaggle Results] Expose via: ssh -R 80:localhost:${port} localhost.run`);
        console.log('═'.repeat(60));
    });

    return wss;
}

function handleDetectionResult(result: any) {
    totalResults++;

    const cameraId = result.camera_id;

    // Emit vehicle detection
    if (result.vehicle && result.vehicle.detections?.length > 0) {
        const vehiclePayload = {
            camera_id: cameraId,
            image_id: result.image_id,
            track_line_y: result.track_line_y || 50,
            detections: result.vehicle.detections,
            inference_time: result.vehicle.inference_time,
            image_dimensions: result.image_dimensions,
            created_at: result.created_at,
            vehicle_count: result.vehicle.vehicle_count,
            tracks: result.vehicle.tracks,
            new_crossings: result.vehicle.new_crossings
        };

        // Emit to all connected Socket.IO clients
        io.emit('car_detected', vehiclePayload);

        if (totalResults % 100 === 0) {
            console.log(`[Kaggle Results] Received ${totalResults} results, ${result.vehicle.detections.length} vehicles`);
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
            created_at: result.created_at
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
}

export function getKaggleResultsStats() {
    return {
        connectedClients,
        totalResults,
    };
}

export default {
    createKaggleResultsServer,
    getKaggleResultsStats,
};
