import { Schema, model } from "mongoose";
import ms from "ms";
import { CAMERA_MODEL_NAME } from "@/models/camera.model.js";

export const CAMERA_IMAGE_MODEL_NAME = "camera_image";
export const CAMERA_IMAGE_COLLECTION_NAME = "camera_images";

export const cameraImageSchema = new Schema({
    cameraId: {
        type: Schema.Types.ObjectId,
        ref: CAMERA_MODEL_NAME,
        required: true,
    },
    image: { type: Buffer, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    created_at: { type: Date, default: Date.now },
}, {
    collection: CAMERA_IMAGE_COLLECTION_NAME,
})

cameraImageSchema.index({ created_at: 1 }, { expireAfterSeconds: ms("1 day") / 1000 });

export default model(CAMERA_IMAGE_MODEL_NAME, cameraImageSchema);