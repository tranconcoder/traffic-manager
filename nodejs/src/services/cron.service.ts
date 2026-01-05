import { CarEnum } from "@/enums/car.enum.js";
import carDetectionModel from "@/models/carDetection.model.js";
import { CronJob } from "cron";
import trafficStatisticsService from "./trafficStatistics.service.js";
import mongoose from "mongoose";

export default new (class CronService {
  startAllJobs() {
    // Disabled: Traffic statistics are now updated realtime via WebSocket
    // when new_crossings are received from Kaggle
    // this.startTrafficStatisticsJob();
    console.log('[CronService] Traffic statistics cron job disabled - using realtime updates');
  }

  /* ---------------------------------------------------------- */
  /*                     Traffic statistics                     */
  /* ---------------------------------------------------------- */
  startTrafficStatisticsJob() {
    CronJob.from({
      cronTime: "0 * * * * *",
      onTick: async function () {
        const allDetectInMinute = await carDetectionModel.find(
          {
            created_at: { $gte: new Date(Date.now() - 60 * 1000) },
          },
          {},
          {
            lean: true,
          }
        );

        const detectionGroupByCamera = Object.groupBy(
          allDetectInMinute,
          (detect) => detect.camera_id.toString()
        );

        await Promise.all(
          Object.entries(detectionGroupByCamera).map(
            async ([cameraId, carDetected]) => {
              const vehicleIdsSet = {
                [CarEnum.CAR]: new Set(),
                [CarEnum.TRUCK]: new Set(),
                [CarEnum.BUS]: new Set(),
                [CarEnum.MOTORCYCLE]: new Set(),
                [CarEnum.BICYCLE]: new Set(),
              };

              /* ------------------- Get vehicle ids set ------------------ */
              (carDetected || []).forEach((detect) => {
                detect.detections.forEach((detection) => {
                  const key = detection.class as keyof typeof vehicleIdsSet;
                  vehicleIdsSet[key].add(detection.id);
                });
              });

              /* --------------------- Save statistics -------------------- */
              const result = await trafficStatisticsService
                .saveStatistics({
                  camera_id: new mongoose.Types.ObjectId(cameraId) as any,

                  date: new Date(Date.now()),

                  minute_of_day:
                    new Date(Date.now()).getMinutes() +
                    new Date(Date.now()).getHours() * 60,

                  vehicle_count: Object.entries(vehicleIdsSet).reduce(
                    (acc, [key, value]) => acc + value.size,
                    0
                  ),

                  vehicle_types: {
                    car: vehicleIdsSet[CarEnum.CAR].size,
                    truck: vehicleIdsSet[CarEnum.TRUCK].size,
                    bus: vehicleIdsSet[CarEnum.BUS].size,
                    motorcycle: vehicleIdsSet[CarEnum.MOTORCYCLE].size,
                  },
                })
                .catch(console.error);

              console.log({
                statistics: result,
              });
            }
          )
        );
      },
      start: true,
      timeZone: "America/Los_Angeles",
    });
  }
})();
