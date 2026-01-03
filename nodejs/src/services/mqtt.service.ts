import mqtt, { MqttClient } from "mqtt";
import sensorDataModel from "@/models/sensorData.model.js";

let mqttClient: MqttClient | null = null;

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://broker.emqx.io:1883";
const MQTT_TOPIC_SENSOR = "traffic-manager/sensor/#";

export function runMqttService(): MqttClient {
    console.log(`[MQTT] Connecting to broker: ${MQTT_BROKER_URL}`);

    mqttClient = mqtt.connect(MQTT_BROKER_URL, {
        clientId: `nodejs-backend-${Date.now()}`,
        clean: true,
        reconnectPeriod: 5000,
    });

    mqttClient.on("connect", () => {
        console.log("[MQTT] Connected to broker");

        // Subscribe to sensor data topic
        mqttClient?.subscribe(MQTT_TOPIC_SENSOR, { qos: 1 }, (err: Error | null) => {
            if (err) {
                console.error("[MQTT] Subscribe error:", err);
            } else {
                console.log(`[MQTT] Subscribed to topic: ${MQTT_TOPIC_SENSOR}`);
            }
        });
    });

    mqttClient.on("message", async (topic: string, message: Buffer) => {
        console.log(`[MQTT] Received on ${topic}:`, message.toString());

        // Parse and save sensor data
        if (topic.startsWith("traffic-manager/sensor/")) {
            try {
                const data = JSON.parse(message.toString());
                console.log("[MQTT] Saving sensor data to MongoDB:", data);

                await sensorDataModel.create(data);
                console.log("[MQTT] Sensor data saved successfully");
            } catch (err: any) {
                console.error("[MQTT] Failed to parse/save sensor data:", err.message);
            }
        }
    });

    mqttClient.on("error", (err: Error) => {
        console.error("[MQTT] Connection error:", err);
    });

    mqttClient.on("close", () => {
        console.log("[MQTT] Connection closed");
    });

    return mqttClient;
}

export function getMqttClient(): MqttClient | null {
    return mqttClient;
}
