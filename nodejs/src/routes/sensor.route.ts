import { Router } from "express";
import sensorController from "@/controllers/sensor.controller.js";

const router = Router();

// GET /api/sensor/history/:cameraId - Get sensor history for a camera
router.get("/history/:cameraId", sensorController.getHistoryByCamera);

export default router;
