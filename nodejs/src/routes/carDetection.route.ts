import { Router } from "express";
import carDetectionController from "@/controllers/carDetection.controller.js";
import { catchError } from "@/middlewares/handleError.middware.js";

const router = Router();

router.get("/stats/:cameraId", catchError(carDetectionController.getStatsByCamera));

export default router;
