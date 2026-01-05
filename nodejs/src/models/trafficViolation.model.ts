import {model, Schema} from "mongoose";
import { timestamps } from "@/config/model.config.js";
import { TrafficViolation } from "@/enums/trafficViolation.enum.js";

export const TRAFFIC_VIOLATION_DOCUMENT_NAME = "trafficViolation";
export const TRAFFIC_VIOLATION_COLLECTION_NAME = "trafficViolation";

export const trafficViolationSchema = new Schema({
    violation_type: {
        type: String,
        enum: TrafficViolation
    },
    violation_license_plate: {
        type: String,
        required: true,
    },
    
}, {
    collection: TRAFFIC_VIOLATION_COLLECTION_NAME,
    timestamps: timestamps
});

export default model(TRAFFIC_VIOLATION_DOCUMENT_NAME, trafficViolationSchema)
