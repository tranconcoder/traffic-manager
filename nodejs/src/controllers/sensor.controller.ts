import { RequestHandler } from "express";
import { OkResponse } from "@/core/success.response.js";
import sensorDataModel from "@/models/sensorData.model.js";

export default new (class SensorController {
    /**
     * Get sensor history by camera ID
     * GET /api/sensor/history/:cameraId
     */
    getHistoryByCamera: RequestHandler<{ cameraId: string }, {}, {}, { limit?: string; from?: string }> = async (req, res, next) => {
        try {
            const { cameraId } = req.params;
            const limit = parseInt(req.query.limit || "100");
            const from = req.query.from ? parseInt(req.query.from) : null;

            // Build query with optional time filter
            const query: any = { camera_id: cameraId };
            if (from) {
                query.created_at = { $gte: new Date(from) };
            }

            const history = await sensorDataModel
                .find(query)
                .sort({ created_at: -1 })
                .limit(limit)
                .lean();

            // Reverse to get chronological order (oldest first)
            const data = history.reverse();

            new OkResponse({
                message: "Get sensor history success",
                metadata: data,
            }).send(res);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };
})();
