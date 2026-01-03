import { Router } from "express";
import violationController from "@/controllers/violation.controller.js";
import { catchError } from "@/middlewares/handleError.middware.js";

const router = Router();

router.get("/all", catchError(violationController.getAllViolations));

router.get("/image/:violation_id", catchError(violationController.getImageBuffer));
router.get("/frames/:violation_id", catchError(violationController.getViolationFrames));

router.patch("/status/:violation_id", catchError(violationController.updateViolationStatus));

export default router;