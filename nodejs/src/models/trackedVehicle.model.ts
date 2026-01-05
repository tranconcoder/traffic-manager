import { Schema, model } from 'mongoose';
import { timestamps } from '@/config/model.config.js';

export const TRACKED_VEHICLE_MODEL_NAME = 'TrackedVehicle';
export const TRACKED_VEHICLE_COLLECTION_NAME = 'tracked_vehicles';

export interface ITrackedVehicle {
    license_plate: string;
    reason: string;
    description?: string;
    created_at: Date;
}

const trackedVehicleSchema = new Schema<ITrackedVehicle>(
    {
        license_plate: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true
        },
        reason: {
            type: String,
            required: true,
        },
        description: {
            type: String,
            required: false,
        }
    },
    {
        timestamps: timestamps,
        collection: TRACKED_VEHICLE_COLLECTION_NAME,
    }
);

// Index cho license_plate để tìm kiếm nhanh
trackedVehicleSchema.index({ license_plate: 1 });

export default model<ITrackedVehicle>(TRACKED_VEHICLE_MODEL_NAME, trackedVehicleSchema);
