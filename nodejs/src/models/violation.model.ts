import { timestamps } from '@/config/model.config.js';
import { TrafficViolation, ViolationStatus } from '@/enums/trafficViolation.enum.js';
import { Schema, model } from 'mongoose';

export interface ViolationLicensePlate {
    camera_id: string;
    license_plate: string;
    violation_type: TrafficViolation;
    violation_status: ViolationStatus;
    image_buffer: Buffer;
}

export const VIOLATION_MODEL_NAME = 'ViolationLicensePlate';
export const VIOLATION_COLLECTION_NAME = 'violation_license_plate';

export const violationLicensePlateSchema = new Schema({
    camera_id: {
        type: String,
        required: true,
    },
    license_plate: {
        type: String,
        required: true,
    },
    violation_type: {
        type: String,
        required: true,
        enum: Object.values(TrafficViolation),
    },
    violation_status: {
        type: String,
        required: true,
        enum: Object.values(ViolationStatus),
    },
    image_buffer: {
        type: Buffer,
        required: true,
    },
    video_frames: [{
        timestamp: Date,
        image: Buffer
    }],
    detection_time: {
        type: Date,
        default: Date.now
    }
}, {
    collection: VIOLATION_COLLECTION_NAME,
    timestamps: timestamps
})

export default model(VIOLATION_MODEL_NAME, violationLicensePlateSchema);