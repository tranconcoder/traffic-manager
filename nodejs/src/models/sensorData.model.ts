import { Schema, model } from 'mongoose';
import ms from 'ms';

export const SENSOR_DATA_MODEL_NAME = 'SensorData';
export const SENSOR_DATA_COLLECTION_NAME = 'sensor_data';

export const sensorDataSchema = new Schema({
    camera_id: { type: Schema.Types.ObjectId, ref: 'Camera', required: true },
    temperature: { type: Number, required: true },
    humidity: { type: Number, required: true },
    created_at: { type: Date, default: Date.now },
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: false
    },
    collection: SENSOR_DATA_COLLECTION_NAME,
});

sensorDataSchema.index({ created_at: -1 }, { expireAfterSeconds: ms('7 days') / 1000 });

export default model(SENSOR_DATA_MODEL_NAME, sensorDataSchema);
