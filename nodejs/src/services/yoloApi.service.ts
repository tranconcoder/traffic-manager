import { envConfig } from "@/config/index.js";

interface DetectionResult {
    camera_id: string;
    created_at: number;
    image_dimensions: { width: number; height: number };
    vehicle?: {
        detections: any[];
        inference_time: number;
        vehicle_count: {
            total_up: number;
            total_down: number;
            by_type_up: Record<string, number>;
            by_type_down: Record<string, number>;
            current: Record<string, number>;
        };
        tracks: any[];
        new_crossings: any[];
    };
    traffic_light?: {
        detections: any[];
        traffic_status: string | null;
        inference_time: number;
    };
}

interface LicensePlateResult {
    license_plates: Record<string, string>;
    inference_time: number;
}

class YoloApiService {
    private apiUrl: string;
    private timeout: number;

    constructor() {
        this.apiUrl = process.env.YOLO_API_URL || "";
        this.timeout = parseInt(process.env.YOLO_API_TIMEOUT || "30000");
    }

    setApiUrl(url: string) {
        this.apiUrl = url;
        console.log(`[YOLO API] URL set to: ${url}`);
    }

    getApiUrl(): string {
        return this.apiUrl;
    }

    isConfigured(): boolean {
        return !!this.apiUrl && this.apiUrl.length > 0;
    }

    async healthCheck(): Promise<boolean> {
        if (!this.isConfigured()) return false;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${this.apiUrl}/health`, {
                method: "GET",
                signal: controller.signal,
            });

            clearTimeout(timeoutId);
            return response.ok;
        } catch (error) {
            console.error("[YOLO API] Health check failed:", error);
            return false;
        }
    }

    async detectVehicles(
        imageBuffer: Buffer,
        cameraId: string,
        trackLineY: number = 50,
        createdAt: number = Date.now()
    ): Promise<DetectionResult | null> {
        if (!this.isConfigured()) {
            console.warn("[YOLO API] Not configured, skipping detection");
            return null;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            // Use FormData for binary upload (no base64 overhead)
            const formData = new FormData();
            formData.append("image", new Blob([imageBuffer]), "frame.jpg");
            formData.append("camera_id", cameraId);
            formData.append("track_line_y", trackLineY.toString());
            formData.append("created_at", createdAt.toString());

            const response = await fetch(`${this.apiUrl}/detect`, {
                method: "POST",
                body: formData,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return (await response.json()) as DetectionResult;
        } catch (error: any) {
            if (error.name === "AbortError") {
                console.error("[YOLO API] Detection request timeout");
            } else {
                console.error("[YOLO API] Detection failed:", error.message);
            }
            return null;
        }
    }

    async detectLicensePlate(
        imageBuffer: Buffer,
        detections: any[]
    ): Promise<LicensePlateResult | null> {
        if (!this.isConfigured()) {
            console.warn("[YOLO API] Not configured, skipping LP detection");
            return null;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            // Use FormData for binary upload
            const formData = new FormData();
            formData.append("image", new Blob([imageBuffer]), "frame.jpg");
            formData.append("detections", JSON.stringify(detections));

            const response = await fetch(`${this.apiUrl}/detect/lp`, {
                method: "POST",
                body: formData,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return (await response.json()) as LicensePlateResult;
        } catch (error: any) {
            if (error.name === "AbortError") {
                console.error("[YOLO API] LP detection request timeout");
            } else {
                console.error("[YOLO API] LP detection failed:", error.message);
            }
            return null;
        }
    }
}

export const yoloApiService = new YoloApiService();
export default yoloApiService;
