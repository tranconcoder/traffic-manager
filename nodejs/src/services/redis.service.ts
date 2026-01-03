import { createClient } from "redis";
import { REDIS_URL } from "../config/redis.config.js";

/* -------------------------------------------------------------------------- */
/*                            Handle connect redis                            */
/* -------------------------------------------------------------------------- */
const client = createClient({
    url: REDIS_URL,
});

client.on("error", (err) => {
    console.error("Redis error", err);
});
client.on("connect", () => {
    console.log("Redis connected");
});

await client.connect();


/* -------------------------------------------------------------------------- */
/*                                  Services                                  */
/* -------------------------------------------------------------------------- */

// Image Caching (Images of the last 1 minute)
export const pushImage = async (cameraId: string, imageData: any) => {
    try {
        const key = `camera_images_v2:${cameraId}`;
        const value = JSON.stringify(imageData);
        const score = imageData.created_at || Date.now();

        // Add to sorted set with timestamp as score
        await client.zAdd(key, { score, value });

        // Remove images older than 1 minute (60000 ms)
        await client.zRemRangeByScore(key, "-inf", score - 60000);
    } catch (error) {
        console.error("Redis pushImage error:", error);
    }
}

export const getRecentImages = async (cameraId: string) => {
    try {
        const key = `camera_images_v2:${cameraId}`;
        // Get all images in the set (which are already limited to 1 minute window)
        // zRange returns sorted from lowest score (oldest) to highest (newest)
        const data = await client.zRange(key, 0, -1);
        return data.map((item: string) => JSON.parse(item));
    } catch (error) {
        console.error("Redis getRecentImages error:", error);
        return [];
    }
}

// Traffic Light Caching
export const setTrafficLightStatus = async (cameraId: string, status: string) => {
    try {
        await client.set(`traffic_light:${cameraId}`, status, { EX: 300 }); // 5 min TTL
    } catch (error) {
        console.error("Redis setTrafficLightStatus error:", error);
    }
}

export const getTrafficLightStatus = async (cameraId: string) => {
    try {
        return await client.get(`traffic_light:${cameraId}`);
    } catch (error) {
        console.error("Redis getTrafficLightStatus error:", error);
        return null;
    }
}

export default client;
