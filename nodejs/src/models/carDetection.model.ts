import { Schema, model } from "mongoose";
import { CAMERA_MODEL_NAME } from "@/models/camera.model.js";
import { CAMERA_IMAGE_MODEL_NAME } from "@/models/cameraImage.model.js";
import ms from "ms";

// Đây là model dùng để tạm thời lưu trữ những thông tin
// mà model đã phát hiện được và sẽ tự động xóa sau 1 giờ

export const CART_DETECTION_MODEL_NAME = "CarDetection";
export const CART_DETECTION_COLLECTION_NAME = "car_detections";

export const cartDetectionSchema = new Schema(
  {
    /* ------------------------------- Foreign key ------------------------------ */
    camera_id: {
      type: Schema.Types.ObjectId,
      ref: CAMERA_MODEL_NAME,
      required: true,
    },
    image_id: {
      type: Schema.Types.ObjectId,
      ref: CAMERA_IMAGE_MODEL_NAME,
      required: false, // Optional for V18+ (no image upload)
    },

    /* -------------------------------- Detection ------------------------------- */
    detections: {
      type: [
        {
          id: { type: Number },
          class: { type: String, required: true },
          confidence: { type: Number, required: true },
          bbox: {
            x1: { type: Number, required: true },
            y1: { type: Number, required: true },
            x2: { type: Number, required: true },
            y2: { type: Number, required: true },
            width: { type: Number },  // Optional - can be calculated from x2-x1
            height: { type: Number }, // Optional - can be calculated from y2-y1
          },
        },
      ],
      required: true,
    },
    inference_time: { type: Number, default: 0 }, // Optional for V18
    vehicle_count: {
      total_up: { type: Number, default: 0 },
      total_down: { type: Number, default: 0 },
      by_type_up: {
        car: { type: Number, default: 0 },
        truck: { type: Number, default: 0 },
        bus: { type: Number, default: 0 },
        motorcycle: { type: Number, default: 0 },
        bicycle: { type: Number, default: 0 },
      },
      by_type_down: {
        car: { type: Number, default: 0 },
        truck: { type: Number, default: 0 },
        bus: { type: Number, default: 0 },
        motorcycle: { type: Number, default: 0 },
        bicycle: { type: Number, default: 0 },
      },
    },
    tracks: {
      type: [
        {
          id: { type: Number, required: true },
          positions: {
            type: [
              {
                x: { type: Number, required: true },
                y: { type: Number, required: true },
                time: { type: Number, required: true },
              },
            ],
            default: [],
          },
          class: { type: String, required: true },
        },
      ],
      default: [],
    },
    new_crossings: {
      type: [
        {
          id: { type: String, required: true },
          direction: { type: String, required: true },
        },
      ],
      default: [],
    },

    /* ------------------------------- Image dimensions ------------------------------ */
    image_dimensions: {
      width: { type: Number, required: true },
      height: { type: Number, required: true },
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
    },
    collection: CART_DETECTION_COLLECTION_NAME,
  }
);

cartDetectionSchema.index(
  { created_at: -1 },
  { expireAfterSeconds: ms("1 day") / 1000 }
);

export default model(CART_DETECTION_MODEL_NAME, cartDetectionSchema);
