import { Types } from "mongoose";
import { RequestHandler } from "express";
import { OkResponse } from "@/core/success.response.js";
import carDetectionModel from "@/models/carDetection.model.js";

export default new class CarDetectionController {
    getStatsByCamera: RequestHandler = async (req, res, next) => {
        const { cameraId } = req.params;

        // Aggregation Plan:
        // 1. Match cameraId
        // 2. Unwind `detections` to access individual vehicle objects
        // 3. Group by `id` (tracking ID) and `class` to dedup (count unique vehicles)
        // 4. Group by `class` to get total counts per type

        const stats = await carDetectionModel.aggregate([
            { $match: { camera_id: new Types.ObjectId(cameraId) } },
            { $unwind: "$detections" },
            // Filter out detections without ID (optional safety)
            { $match: { "detections.id": { $exists: true, $ne: null } } },
            // Group by ID to get unique vehicles. 
            // Note: If a vehicle changes class (rare but possible), it might be counted double or last one wins. 
            // Grouping by ID is safer. We pick the 'first' class seen or 'last'.
            {
                $group: {
                    _id: "$detections.id",
                    class: { $last: "$detections.class" } // Use most recent class classification
                }
            },
            // Now group by class to count
            {
                $group: {
                    _id: "$class",
                    count: { $sum: 1 }
                }
            }
        ]);

        // Transform to cleaner object
        const result = {
            car: 0, truck: 0, bus: 0, motorcycle: 0
        };
        stats.forEach(s => {
            if (s._id && result.hasOwnProperty(s._id)) {
                // @ts-ignore
                result[s._id] = s.count;
            }
        });

        new OkResponse({
            message: "Get car statistics successfully",
            metadata: result
        }).send(res);
    }
}
