import cameraModel, { CameraModel } from "@/models/camera.model.js";
import trafficLightService from "./trafficLight.service.js";
import { TrafficLightEnum } from "@/enums/trafficLight.enum.js";
import { Detect } from "./violation.service.d.js";
import { CarEnum } from "@/enums/car.enum.js";
import { ViolationLicensePlateDetect } from "@/utils/socketio.util.d.js";
import { ViolationStatus } from "@/enums/trafficViolation.enum.js";
import violationModel from "@/models/violation.model.js";
import cameraImageModel from "@/models/cameraImage.model.js";
import { getRecentImages } from "@/services/redis.service.js";

export default new (class ViolationService {
  /* -------------------------------------------------------------------------- */
  /*                                   Get all                                  */
  /* -------------------------------------------------------------------------- */
  async getAllViolations() {
    // Group by license_plate and return all violations for each license plate
    return await violationModel.aggregate([
      {
        $group: {
          _id: "$license_plate",
          license_plate: { $first: "$license_plate" },
          violations: {
            $push: {
              _id: "$_id",
              camera_id: "$camera_id",
              violation_type: "$violation_type",
              violation_status: "$violation_status",
              created_at: "$createdAt",
              updated_at: "$updatedAt",
              detection_time: "$detection_time"
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          license_plate: 1,
          violations: 1,
        },
      },
    ]);
  }

  async getImageBuffer(violation_id: string) {
    const violation = await violationModel.findById(violation_id);
    if (!violation?.image_buffer) {
      throw new Error("Violation not found");
    }

    return violation.image_buffer;
  }

  async getViolationFrames(violation_id: string) {
    const violation = await violationModel.findById(violation_id).select('video_frames');
    if (!violation?.video_frames) {
      return [];
    }
    return violation.video_frames;
  }

  /* -------------------------------------------------------------------------- */
  /*                                Update status                               */
  /* -------------------------------------------------------------------------- */
  async updateViolationStatus(violationId: string, status: ViolationStatus) {
    const violation = await violationModel.findByIdAndUpdate(
      violationId,
      { violation_status: status },
      { new: true }
    );

    if (!violation) {
      throw new Error("Violation not found");
    }

    return violation;
  }

  /* -------------------------------------------------------------------------- */
  /*                                   Create                                   */
  /* -------------------------------------------------------------------------- */
  async saveViolation(data: ViolationLicensePlateDetect) {
    const violationList = Object.entries(data.license_plates).flatMap(
      ([id, license_plate]) => {
        const vehicleViolation = data.violations.filter(
          (violation) => violation.id === Number(id)
        );

        return vehicleViolation.map((violation) => {
          return {
            license_plate: license_plate,
            violation_type: violation.type,
            violation_status: ViolationStatus.PENDING,
          };
        });
      }
    );

    // Get images from Redis (High FPS)
    const allRedisImages = await getRecentImages(data.camera_id);

    // Find main image
    let mainImage = allRedisImages.find((img: any) =>
      (data.image_id && img.imageId === data.image_id) ||
      (Math.abs(img.created_at - (data.created_at || Date.now())) < 100)
    );

    // If not in Redis (expired?), try MongoDB (1FPS fallback)
    if (!mainImage) {
      const doc = await cameraImageModel.findById(data.image_id);
      if (doc) mainImage = { image: doc.image, created_at: doc.created_at, width: doc.width, height: doc.height };
    }

    const detectionTime = mainImage?.created_at ? new Date(mainImage.created_at) : new Date();
    // Restore buffer if needed
    let imageBuffer = mainImage?.image;
    if (imageBuffer && imageBuffer.type === 'Buffer') imageBuffer = Buffer.from(imageBuffer.data);
    else if (imageBuffer && Array.isArray(imageBuffer.data)) imageBuffer = Buffer.from(imageBuffer.data);

    // Get context frames ±7s
    const startTime = detectionTime.getTime() - 7000;
    const endTime = detectionTime.getTime() + 7000;

    const contextFrames = allRedisImages.filter((img: any) =>
      img.created_at >= startTime && img.created_at <= endTime
    ).sort((a: any, b: any) => a.created_at - b.created_at);

    // Also persist these context frames to cameraImageModel?
    // User said "mongodb saves violations". Use insertMany to save them as records IF they don't exist?
    // But this function saves to `violationModel`.
    // The requirement "mongodb only saves... violation images" likely means we should save to `cameraImageModel` OR `violationModel`.
    // The current code saves to `violationModel` (embedded). I will stick to that to avoid schema changes.
    // If specific save to `cameraImageModel` is needed, I'd add it, but avoiding duplicates is tricky.

    const videoFrames = contextFrames.map((f: any) => ({
      timestamp: new Date(f.created_at),
      image: (f.image && f.image.type === 'Buffer') ? Buffer.from(f.image.data) : Buffer.from(f.image)
    }));

    await Promise.all(
      violationList.map(async (violation) => {
        await violationModel.findOneAndUpdate(
          {
            license_plate: violation.license_plate,
            camera_id: data.camera_id,
            violation_type: violation.violation_type,
            violation_status: ViolationStatus.PENDING,
            created_at: { $gte: new Date(Date.now() - 1000 * 60) },
          },
          {
            image_buffer: imageBuffer,
            detection_time: detectionTime,
            video_frames: videoFrames
          },
          {
            upsert: true,
            new: true,
          }
        );
      })
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                                   Detect                                   */
  /* -------------------------------------------------------------------------- */
  async detectRedLightViolation(data: Detect, camera: CameraModel) {
    let { camera_id, detections, tracks, image_dimensions } = data;

    const detectionIds = detections.map((detection) => detection.id);
    const scaledTrackLineY =
      camera.camera_track_line_y * (image_dimensions.height / 100);
    tracks = tracks.filter((vehicle) => {
      return detectionIds.includes(vehicle.id);
    });

    const vehicleIds = await Promise.all(
      tracks.map(async (vehicle) => {
        /* ------------------------ Get current traffic light ----------------------- */
        /* ------------------------ Get current traffic light ----------------------- */
        // Optimization: Only check the last 2 positions (movement in current frame)
        // detailed history check is redundant as it was checked in previous frames.
        const recentPositions = vehicle.positions.slice(-2);

        if (recentPositions.length < 2) return null;

        const trafficLightStatusList = (
          await Promise.all(
            recentPositions.map(async ({ time, x, y }) => {
              return {
                trafficStatus: await trafficLightService.getTrafficLightByTime(
                  time,
                  camera_id // Pass camera_id for Redis lookup
                ),
                overcomeRedLightLine: y < scaledTrackLineY, // Vượt qua đèn đỏ
              };
            })
          )
        ).filter((item) => item.trafficStatus !== null);

        /* ------------------------ Detect red light violation ----------------------- */
        for (let i = 0; i < trafficLightStatusList.length - 1; i++) {
          const trafficLightStatusPair = [
            trafficLightStatusList[i],
            trafficLightStatusList[i + 1],
          ];

          if (
            trafficLightStatusPair[0].trafficStatus === TrafficLightEnum.RED &&
            trafficLightStatusPair[1].trafficStatus === TrafficLightEnum.RED &&
            trafficLightStatusPair[0].overcomeRedLightLine === false &&
            trafficLightStatusPair[1].overcomeRedLightLine === true
          ) {
            return vehicle.id;
          }
        }

        return null;
      })
    ).then((ids) => ids.filter((id) => id !== null));

    if (vehicleIds.length > 0) {
      console.log("Red light violation ids: ", vehicleIds);
    }

    return vehicleIds;
  }

  async laneEncroachment(
    detections: Detect["detections"],
    imageDimensions: Detect["image_dimensions"],
    camera: CameraModel
  ) {
    const { camera_lane_vehicles } = camera;
    const camera_lane_track_point = [...camera.camera_lane_track_point, 100];

    const vehicleViolationIds = [];
    const scaledWidth = imageDimensions.width / 100;

    /* ------------------------ Detect lane encroachment ----------------------- */
    for (const detection of detections) {
      const { id, class: vehicleClass, bbox } = detection;
      const { x1, x2 } = bbox;

      /* ------------------------ Get lane start and end index ----------------------- */
      const laneStartIndex = camera_lane_track_point.findIndex(
        (item) => item * scaledWidth > x1 * imageDimensions.width
      );
      const laneEndIndex = camera_lane_track_point.findIndex(
        (item) => item * scaledWidth > x2 * imageDimensions.width
      );

      const vehiclesInLane = camera_lane_vehicles.slice(
        laneStartIndex,
        laneEndIndex + 1
      );

      /* ------------------------ Detect lane encroachment ----------------------- */
      const isViolation = vehiclesInLane.some(
        (laneVehicle) =>
          !laneVehicle.includes(CarEnum.ANY) &&
          !laneVehicle.includes(vehicleClass as CarEnum)
      );

      if (isViolation) {
        vehicleViolationIds.push(id);
      }
    }

    if (vehicleViolationIds.length > 0) {
      console.log("Lane encroachment ids: ", vehicleViolationIds);
    }

    return vehicleViolationIds;
  }
})();
