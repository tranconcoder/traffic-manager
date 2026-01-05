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

// Image Caching - Retention: 3 seconds, Max: 30 images per camera
// WARNING: Giữ thời gian retention ngắn để tránh tràn RAM!
const IMAGE_RETENTION_MS = 3000; // 3 giây
const MAX_IMAGES_PER_CAMERA = 30; // Giới hạn số ảnh tối đa trong Redis

export const pushImage = async (cameraId: string, imageData: any) => {
    try {
        const key = `camera_images_v2:${cameraId}`;
        const value = JSON.stringify(imageData);
        const score = imageData.created_at || Date.now();

        // Add to sorted set with timestamp as score
        await client.zAdd(key, { score, value });

        // Remove images older than retention time
        await client.zRemRangeByScore(key, "-inf", score - IMAGE_RETENTION_MS);

        // ALSO limit by count - keep only newest MAX_IMAGES_PER_CAMERA images
        // zRemRangeByRank removes from start (oldest) to specified index
        const count = await client.zCard(key);
        if (count > MAX_IMAGES_PER_CAMERA) {
            // Remove oldest images to keep only MAX_IMAGES_PER_CAMERA
            await client.zRemRangeByRank(key, 0, count - MAX_IMAGES_PER_CAMERA - 1);
            console.log(`[Redis][DEBUG] Trimmed camera ${cameraId.slice(-4)} images: ${count} -> ${MAX_IMAGES_PER_CAMERA}`);
        }
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
