import { TrafficLightEnum } from "@/enums/trafficLight.enum.js";
import trafficLightModel from "@/models/trafficLight.model.js";
import { getTrafficLightStatus } from "@/services/redis.service.js"; // Import Redis

export default new class TrafficLightService {
  async getTrafficLightByTime(time: number, cameraId?: string) {
    // Try Redis if cameraId provided and time is recent
    if (cameraId && Math.abs(Date.now() - time) < 5000) {
      const cached = await getTrafficLightStatus(cameraId);
      if (cached) {
        // Map string to Enum if needed
        // Enum usually is RED, GREEN, YELLOW. Cached is same.
        return cached as TrafficLightEnum;
      }
    }

    // MongoDB Aggregation (Original Logic)
    const trafficLights = await trafficLightModel
      .aggregate([
        {
          $addFields: {
            createdAtValue: { $toLong: "$created_at" },
          },
        },
        {
          $addFields: {
            timeDifference: {
              $subtract: [time, "$createdAtValue"]
            },
          },
        },
        {
          $match: {
            timeDifference: {
              $lte: 0
            }
          }
        },
        {
          $sort: { timeDifference: 1 },
        },
        {
          $limit: 1,
        },
      ])
      .exec();

    const trafficLight = trafficLights.length > 0 ? trafficLights[0].traffic_status : null;

    return trafficLight as TrafficLightEnum;
  }
}