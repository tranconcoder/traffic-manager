import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import handleEvent from "../utils/socketio.util.js";

export function runSocketIOService(server: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(server, {
    pingTimeout: 60000,
    pingInterval: 5000, // 5s aggressive ping to keep tunnel open
    cors: { origin: "*" },
    transports: ["websocket"],
    allowUpgrades: false,
    perMessageDeflate: false,
    allowEIO3: true, // Support older clients
    maxHttpBufferSize: 1e8 // 100 MB to prevent disconnect on large images
  }); // Store the instance

  io.on("connection", async (socket: Socket) => {
    console.log(`SOCKET.IO CLIENT CONNECTED: ${socket.id}`);

    /* -------------------------------------------------------------------------- */
    /*                              Join room handler                             */
    /* -------------------------------------------------------------------------- */

    /* ------------------- Setup 'join_camera' event handler -------------------- */
    socket.on("join_camera", handleEvent("join_camera").bind(socket));

    /* ------------------ Setup 'join_all_camera' event handler ----------------- */
    socket.on("join_all_camera", handleEvent("join_all_camera").bind(socket));

    /* ------------------ Setup 'leave_camera' event handler -------------------- */
    socket.on("leave_camera", handleEvent("leave_camera").bind(socket));

    /* -------------------------------------------------------------------------- */
    /*                                Event handler                               */
    /* -------------------------------------------------------------------------- */

    /* ------------------------ Set 'image' event handler ----------------------- */
    socket.on("image", handleEvent("image").bind(socket));

    /* -------------------- Set 'traffic_light' event handler ------------------- */
    socket.on("traffic_light", handleEvent("traffic_light").bind(socket));

    /* -------------------- Set 'car_detected' event handler -------------------- */
    socket.on("car_detected", handleEvent("car_detected").bind(socket));

    /* ----------------- Set 'violation_license_plate' event handler ------------- */
    socket.on(
      "violation_license_plate",
      handleEvent("violation_license_plate").bind(socket)
    );

    socket.on("disconnect", () => {
      console.log(`Socket.IO Client disconnected: ${socket.id}`);
    });
  });

  console.log("Socket.IO service logic initialized.");

  return io;
}
