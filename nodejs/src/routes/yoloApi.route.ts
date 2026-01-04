import { Router, Request, Response, NextFunction, RequestHandler } from "express";
import { yoloApiService } from "@/services/yoloApi.service.js";
import { OkResponse } from "@/core/success.response.js";

const router = Router();

// Get current YOLO API status
const getStatus: RequestHandler = async (req, res, next) => {
    try {
        const isConfigured = yoloApiService.isConfigured();
        const isHealthy = isConfigured ? await yoloApiService.healthCheck() : false;

        new OkResponse({
            message: "YOLO API status",
            metadata: {
                configured: isConfigured,
                url: yoloApiService.getApiUrl() || null,
                healthy: isHealthy,
            },
        }).send(res);
    } catch (error) {
        next(error);
    }
};

// Set YOLO API URL
const setUrl: RequestHandler = async (req, res, next) => {
    try {
        const { url } = req.body;

        if (!url || typeof url !== "string") {
            res.status(400).json({ error: "URL is required" });
            return;
        }

        // Validate URL format
        try {
            new URL(url);
        } catch {
            res.status(400).json({ error: "Invalid URL format" });
            return;
        }

        yoloApiService.setApiUrl(url);

        // Check health
        const isHealthy = await yoloApiService.healthCheck();

        new OkResponse({
            message: isHealthy ? "YOLO API configured successfully" : "URL set but health check failed",
            metadata: {
                url: url,
                healthy: isHealthy,
            },
        }).send(res);
    } catch (error) {
        next(error);
    }
};

// Clear YOLO API URL
const clearUrl: RequestHandler = async (req, res, next) => {
    try {
        yoloApiService.setApiUrl("");

        new OkResponse({
            message: "YOLO API URL cleared",
            metadata: { configured: false },
        }).send(res);
    } catch (error) {
        next(error);
    }
};

// Test detection with a sample image
const testDetection: RequestHandler = async (req, res, next) => {
    try {
        if (!yoloApiService.isConfigured()) {
            res.status(400).json({ error: "YOLO API not configured" });
            return;
        }

        const { image } = req.body; // Base64 image

        if (!image) {
            res.status(400).json({ error: "Image (base64) is required" });
            return;
        }

        const buffer = Buffer.from(image, "base64");
        const result = await yoloApiService.detectVehicles(buffer, "test-camera", 50, Date.now());

        new OkResponse({
            message: "Detection test completed",
            metadata: result || {},
        }).send(res);
    } catch (error) {
        next(error);
    }
};

router.get("/status", getStatus);
router.post("/url", setUrl);
router.delete("/url", clearUrl);
router.post("/test", testDetection);

export default router;
