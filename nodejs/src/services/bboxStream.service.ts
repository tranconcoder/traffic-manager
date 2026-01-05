import Ffmpeg from 'fluent-ffmpeg';
import { streamManager } from './stream.service.js';
import { PassThrough } from 'stream';
import {
    RTMP_SERVER_BASE_URL,
} from '@/config/ffmpeg.config.js';

interface Detection {
    class: string;
    confidence: number;
    id?: number;  // Tracking ID (legacy)
    track_id?: number; // Tracking ID (V19+)
    license_plate?: string; // Detected plate
    bbox?: { x1: number; y1: number; x2: number; y2: number; width?: number; height?: number } | [number, number, number, number];
    bbox_pixels?: [number, number, number, number]; // [x1, y1, x2, y2] in pixels
}

// Helper to extract bbox coordinates
function getBboxCoords(det: Detection, imgWidth: number, imgHeight: number): [number, number, number, number] {
    // Prefer bbox_pixels if available (already in pixels)
    if (det.bbox_pixels && Array.isArray(det.bbox_pixels)) {
        return det.bbox_pixels;
    }

    // Handle bbox object with normalized coords
    if (det.bbox && typeof det.bbox === 'object' && !Array.isArray(det.bbox)) {
        const { x1, y1, x2, y2 } = det.bbox;
        // If values are < 1, they're normalized - convert to pixels
        if (x1 <= 1 && y1 <= 1 && x2 <= 1 && y2 <= 1) {
            return [x1 * imgWidth, y1 * imgHeight, x2 * imgWidth, y2 * imgHeight];
        }
        return [x1, y1, x2, y2];
    }

    // Handle bbox array
    if (det.bbox && Array.isArray(det.bbox)) {
        return det.bbox;
    }

    return [0, 0, 0, 0];
}

interface CameraAIState {
    detections: Detection[];
    vehicleDetections?: Detection[];
    trafficLightDetections?: Detection[];
    trackHistory: Map<number, Array<{ x: number, y: number }>>;
    ffmpegCommand: Ffmpeg.FfmpegCommand | null;
    inputStream: PassThrough;
    isActive: boolean;
    lastLoggedDets?: number;   // For log dedup
    lastLoggedTracks?: number; // For log dedup
}

// Color map for detection classes
const CLASS_COLORS: Record<string, string> = {
    car: '0x00FF00',      // Green
    truck: '0x0000FF',    // Blue
    bus: '0xFFFF00',      // Yellow
    motorcycle: '0xFF00FF', // Magenta
    bicycle: '0x00FFFF',  // Cyan
    person: '0xFF0000',   // Red
    default: '0xFFFFFF',  // White
};

class BBoxStreamManager {
    private cameras: Map<string, CameraAIState> = new Map();

    /**
     * Update detections for a camera
     * Detections will be applied on next frame
     */
    updateDetections(cameraId: string, detections: Detection[], type: 'vehicle' | 'traffic_light' = 'vehicle') {
        let state = this.cameras.get(cameraId);
        if (!state) {
            state = {
                detections: [],
                vehicleDetections: [],
                trafficLightDetections: [],
                trackHistory: new Map(),
                ffmpegCommand: null,
                inputStream: new PassThrough(),
                isActive: false,
            };
            this.cameras.set(cameraId, state);
        }

        if (type === 'vehicle') {
            state.vehicleDetections = detections;
        } else if (type === 'traffic_light') {
            state.trafficLightDetections = detections;
        } else {
            state.detections = detections;
        }

        // Merge for overlay
        state.detections = [...(state.vehicleDetections || []), ...(state.trafficLightDetections || [])];

        // Update track history for each detection with ID
        for (const det of detections) {
            const trackId = det.track_id ?? det.id;
            if (trackId !== undefined && det.bbox_pixels) {
                const [x1, y1, x2, y2] = det.bbox_pixels;
                const cx = Math.round((x1 + x2) / 2);
                const cy = Math.round((y1 + y2) / 2);

                if (!state.trackHistory.has(trackId)) {
                    state.trackHistory.set(trackId, []);
                }
                const history = state.trackHistory.get(trackId)!;
                history.push({ x: cx, y: cy });

                // Keep only last 30 positions
                if (history.length > 30) {
                    history.shift();
                }
            }
        }

        // Clean up old tracks (IDs not seen in current detections)
        const currentIds = new Set(detections.filter(d => (d.track_id ?? d.id) !== undefined).map(d => (d.track_id ?? d.id)!));
        for (const [id] of state.trackHistory) {
            if (!currentIds.has(id)) {
                // Keep for a few more frames, then remove
                const history = state.trackHistory.get(id);
                if (history && history.length > 0) {
                    // Mark for removal by clearing
                    state.trackHistory.delete(id);
                }
            }
        }
    }

    /**
     * Get current detections for a camera
     */
    getDetections(cameraId: string): Detection[] {
        return this.cameras.get(cameraId)?.detections || [];
    }

    /**
     * Build FFmpeg drawbox filter string from detections
     */
    private buildDrawboxFilter(detections: Detection[]): string {
        if (!detections || detections.length === 0) {
            return 'null'; // Pass-through filter
        }

        const drawboxes = detections.map((det) => {
            const [x1, y1, x2, y2] = getBboxCoords(det, 640, 480); // Use default size for filter
            const width = x2 - x1;
            const height = y2 - y1;
            const color = CLASS_COLORS[det.class.toLowerCase()] || CLASS_COLORS.default;

            // drawbox=x:y:w:h:color:thickness
            return `drawbox=x=${Math.floor(x1)}:y=${Math.floor(y1)}:w=${Math.floor(width)}:h=${Math.floor(height)}:color=${color}:t=2`;
        });

        // Chain multiple drawbox filters
        return drawboxes.join(',');
    }

    /**
     * Start AI FFmpeg stream for a camera
     */
    startAIStream(cameraId: string) {
        let state = this.cameras.get(cameraId);
        if (!state) {
            state = {
                detections: [],
                trackHistory: new Map(),
                ffmpegCommand: null,
                inputStream: new PassThrough(),
                isActive: false,
            };
            this.cameras.set(cameraId, state);
            console.log(`[BBoxStream] Created state for ${cameraId}`);
        }

        if (state.isActive) {
            // console.log(`[BBoxStream] Already active for ${cameraId}`);
            return;
        }

        console.log(`[BBoxStream] Launching FFmpeg for ${cameraId}`);
        this.launchFFmpeg(cameraId, state);
    }

    /**
     * Launch FFmpeg with passthrough (no filter needed - boxes drawn on frames)
     */
    private launchFFmpeg(cameraId: string, state: CameraAIState) {
        const rtmpUrl = `${RTMP_SERVER_BASE_URL}/${cameraId}_ai`;

        // Create new input stream
        state.inputStream = new PassThrough();

        state.ffmpegCommand = Ffmpeg({ priority: 0 })
            .input(state.inputStream)
            .inputFormat('image2pipe')
            .inputOptions([
                '-use_wallclock_as_timestamps 1',
                '-vcodec mjpeg',
            ])
            .withNoAudio()
            // No filter needed - boxes are pre-drawn on frames
            .outputOptions([
                '-preset fast',
                '-tune zerolatency',
                '-c:v libx264',
                '-crf 23',
                '-maxrate 2000k',
                '-bufsize 4000k',
                '-vsync cfr',
                '-pix_fmt yuv420p',
                '-g 50',
                '-f flv',
                '-r 25',
            ])
            .output(rtmpUrl)
            .on('start', (cmd) => {
                console.log(`[BBoxStream] Started AI stream for ${cameraId}`);
            })
            .on('error', (err) => {
                if (!err.message.includes('SIGKILL')) {
                    console.error(`[BBoxStream] Error ${cameraId}:`, err.message);
                }
                state.isActive = false;
            })
            .on('end', () => {
                console.log(`[BBoxStream] Ended ${cameraId}`);
                state.isActive = false;
            });

        state.ffmpegCommand.run();
        state.isActive = true;
    }

    /**
     * Restart FFmpeg with new filter (when detections change)
     */
    private restartWithNewFilters(cameraId: string) {
        const state = this.cameras.get(cameraId);
        if (!state) return;

        // Kill existing FFmpeg
        if (state.ffmpegCommand) {
            state.inputStream.end();
            state.ffmpegCommand.kill('SIGKILL');
            state.ffmpegCommand = null;
        }

        // Small delay before restart
        setTimeout(() => {
            if (state) {
                state.isActive = false;
                this.launchFFmpeg(cameraId, state);
            }
        }, 100);
    }

    /**
     * Process a frame: draw bounding boxes and push to AI stream
     */
    async processFrame(cameraId: string, frameBuffer: Buffer) {
        const state = this.cameras.get(cameraId);
        if (!state || !state.isActive) return;

        try {
            // Get current detections
            const detections = state.detections || [];

            if (detections.length === 0) {
                // No detections, pass frame as-is
                state.inputStream.write(frameBuffer);
                return;
            }

            // Import sharp dynamically to draw bboxes
            const sharp = (await import('sharp')).default;

            // Get image metadata
            const image = sharp(frameBuffer);
            const metadata = await image.metadata();
            const width = metadata.width || 640;
            const height = metadata.height || 480;

            // Create SVG overlay with bounding boxes
            let svgOverlay = '<svg width="' + width + '" height="' + height + '">';

            // Only log when detection count changes
            const currDets = detections.length;
            const currTracks = state.trackHistory.size;
            if (state.lastLoggedDets !== currDets || state.lastLoggedTracks !== currTracks) {
                console.log(`[BBoxStream] Drawing overlay for ${cameraId}. Dets: ${currDets}. Tracks: ${currTracks}`);
                state.lastLoggedDets = currDets;
                state.lastLoggedTracks = currTracks;
            }

            // Draw tracking lines first (so they appear behind boxes)
            for (const [trackId, positions] of state.trackHistory) {
                if (positions.length >= 2) {
                    // Create polyline points
                    const points = positions.map(p => `${p.x},${p.y}`).join(' ');

                    // Get color from current detection with this ID
                    const det = detections.find(d => (d.track_id ?? d.id) === trackId);
                    let lineColor = '#00FF00';
                    if (det) {
                        if (det.class === 'truck') lineColor = '#0000FF';
                        else if (det.class === 'bus') lineColor = '#FFFF00';
                        else if (det.class === 'motorcycle') lineColor = '#FF00FF';
                    }

                    // Draw polyline for track
                    svgOverlay += `<polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-opacity="0.7"/>`;

                    // Draw small circles at each point
                    for (let i = 0; i < positions.length; i++) {
                        const opacity = 0.3 + (i / positions.length) * 0.7; // Fade older points
                        const radius = 2 + (i / positions.length) * 2; // Smaller older points
                        svgOverlay += `<circle cx="${positions[i].x}" cy="${positions[i].y}" r="${radius}" fill="${lineColor}" fill-opacity="${opacity}"/>`;
                    }
                }
            }

            // Draw bounding boxes
            for (const det of detections) {
                const [x1, y1, x2, y2] = getBboxCoords(det, width, height);
                const boxWidth = x2 - x1;
                const boxHeight = y2 - y1;

                // Color based on class
                let color = '#00FF00';
                if (det.class === 'truck') color = '#0000FF';
                else if (det.class === 'bus') color = '#FFFF00';
                else if (det.class === 'motorcycle') color = '#FF00FF';

                // Draw rectangle
                svgOverlay += `<rect x="${x1}" y="${y1}" width="${boxWidth}" height="${boxHeight}" fill="none" stroke="${color}" stroke-width="2"/>`;

                // Draw label background and text
                const trackId = det.track_id ?? det.id;
                const idLabel = trackId !== undefined ? `#${trackId} ` : '';
                const lpLabel = det.license_plate ? ` [${det.license_plate}]` : '';
                const label = `${idLabel}${det.class} ${(det.confidence * 100).toFixed(0)}%${lpLabel}`;
                const labelWidth = Math.max(140, label.length * 8);
                svgOverlay += `<rect x="${x1}" y="${y1 - 20}" width="${labelWidth}" height="20" fill="${color}" opacity="0.7"/>`;
                svgOverlay += `<text x="${x1 + 5}" y="${y1 - 5}" font-family="monospace" font-size="12" fill="#000">${label}</text>`;
            }
            svgOverlay += '</svg>';

            // Composite SVG overlay onto image
            const processedBuffer = await image
                .composite([{
                    input: Buffer.from(svgOverlay),
                    top: 0,
                    left: 0
                }])
                .jpeg()
                .toBuffer();

            state.inputStream.write(processedBuffer);
        } catch (err) {
            console.error('[BBoxStream] Frame processing error:', err);
            // On error, pass original frame
            try {
                state.inputStream.write(frameBuffer);
            } catch { }
        }
    }

    /**
     * Process a frame from Redis: lookup by timestamp, draw bboxes, push to AI stream
     */
    async processFrameFromRedis(cameraId: string, timestamp: number) {
        const state = this.cameras.get(cameraId);
        if (!state || !state.isActive) return;

        try {
            // Import Redis service
            const { getRecentImages } = await import('@/services/redis.service.js');

            // Fetch recent images from Redis
            const recentImages = await getRecentImages(cameraId);
            // console.log(`[BBoxStream] Fetched ${recentImages.length} images from Redis for ${cameraId}`);

            // Find image by timestamp (closest match within 1000ms)
            const redisImage = recentImages.find((img: any) =>
                Math.abs((img.created_at || 0) - timestamp) < 1000
            );

            if (!redisImage) {
                if (recentImages.length > 0) {
                    const first = recentImages[0].created_at;
                    const diff = first - timestamp;
                    console.warn(`[BBoxStream] Image not found match for ${timestamp}. Closest diff: ${diff}ms. Count: ${recentImages.length}`);
                } else {
                    console.warn(`[BBoxStream] No images in Redis for ${cameraId}`);
                }
                return;
            } else {
                // console.log(`[BBoxStream] Found matched image in Redis for ${timestamp}`);
            }

            // Restore Buffer from Redis data
            let frameBuffer: Buffer | null = null;
            if (redisImage.image && redisImage.image.type === 'Buffer') {
                frameBuffer = Buffer.from(redisImage.image.data);
            } else if (Array.isArray(redisImage.image?.data)) {
                frameBuffer = Buffer.from(redisImage.image.data);
            } else if (redisImage.image) {
                frameBuffer = Buffer.from(redisImage.image);
            }

            if (!frameBuffer) {
                console.warn(`[BBoxStream] Could not restore image buffer from Redis`);
                return;
            }

            // Now process this frame with current detections
            await this.processFrame(cameraId, frameBuffer);

        } catch (err) {
            console.error('[BBoxStream] Error processing frame from Redis:', err);
        }
    }

    /**
     * Stop AI stream for a camera
     */
    stopAIStream(cameraId: string) {
        const state = this.cameras.get(cameraId);
        if (!state) return;

        if (state.ffmpegCommand) {
            state.inputStream.end();
            state.ffmpegCommand.kill('SIGKILL');
            state.isActive = false;
        }
    }
}

export const bboxStreamManager = new BBoxStreamManager();
