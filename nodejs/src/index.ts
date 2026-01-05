// Express app
import express from "express";
import session, { SessionOptions } from "express-session";
import handleRoute from "@/routes/index.js";
import bodyParser from "body-parser";

// Handlebars
import path from "path";
import SetupHandlebars from "@/services/handlebars.service.js";

// Https server -> Removed
// import fs from "fs";
// import https from "https";

// Websocket Server
import runWebsocketService from "@/services/websocket.service.js";
import runCameraWsService from "@/services/cameraWs.service.js";
import runKaggleWsService from "@/services/kaggleWs.service.js";
import { WebSocketServer } from "ws";

// Services
import * as ffmpegService from "@/services/ffmpeg.service.js";
import { runMqttService } from "@/services/mqtt.service.js";

// Morgan
import morgan from "morgan";

// Environments
import { envConfig } from "@/config/index.js";

// Secure
import cors from "cors";
import { createServer } from "http"; // Import createServer from http
import { runSocketIOService } from "@/services/socketio.service.js";
import DBCore from "@/core/db.core.js";
import HandleErrorService from "@/services/handleError.service.js";

// Constants
const { HOST, PORT } = envConfig;

// Services
import cronService from "./services/cron.service.js";

// SSL Certificates -> Removed for Tunnel/HTTP usage
// const privateKey = ...
// const certificate = ...
// const credentials = ...

// Server
// Server
import url from "url"; // Import url module

const app = express();
// Use createServer from http for simplicity, assuming HTTPS isn't strictly needed for internal Socket.IO
const httpServer = createServer(app);

// Legacy WebSocket Server (backward compatible with old Kaggle)
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 102400 * 1024,
});

// V2 WebSocket Servers with dedicated paths
const cameraWss = new WebSocketServer({
  noServer: true,
  maxPayload: 102400 * 1024,
});

const kaggleWss = new WebSocketServer({
  noServer: true,
  maxPayload: 10 * 1024 * 1024, // 10MB for JSON results
});

// Handle upgrade manually with path routing
httpServer.on('upgrade', (request, socket, head) => {
  const parsedUrl = url.parse(request.url || '', true);
  const pathname = parsedUrl.pathname;

  console.log(`[WS Upgrade] Path: ${pathname}`);

  // Let Socket.IO handle /socket.io requests
  if (pathname && pathname.startsWith('/socket.io/')) {
    return;
  }

  // V2: Camera WebSocket (/ws/camera)
  if (pathname === '/ws/camera') {
    cameraWss.handleUpgrade(request, socket, head, (ws) => {
      cameraWss.emit('connection', ws, request);
    });
    return;
  }

  // V2: Kaggle WebSocket (/ws/kaggle)
  if (pathname === '/ws/kaggle') {
    kaggleWss.handleUpgrade(request, socket, head, (ws) => {
      kaggleWss.emit('connection', ws, request);
    });
    return;
  }

  // Legacy: Handle /? or root path (backward compatible)
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

//
// SESSION
//
const sessionOptions: SessionOptions = {
  resave: true,
  saveUninitialized: true,
  secret: "somesecret",
  cookie: { maxAge: 600000, httpOnly: false },
};

app.use(session(sessionOptions));

//
// SOCKET.IO
//
const io = runSocketIOService(httpServer);

//
// CORS
//
app.use(cors({ origin: "*" }));

//
// MORGAN
//
app.use(morgan("tiny"));

//
// BODY PARSER
//
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.raw());
app.use(bodyParser.text());
app.use(bodyParser.json());

//
// STATIC FILES
//
app.use("/public", express.static(path.join(import.meta.dirname, "../public")));
app.use(
  "/css",
  express.static(path.join(import.meta.dirname, "../public/css"))
);
app.use(
  "/scripts",
  express.static(path.join(import.meta.dirname, "../public/scripts"))
);

//
// HANDLEBARS
//
const setupExHbs = new SetupHandlebars(app);
setupExHbs.setup();

//
// DATABASE
//
DBCore.getInstance().connect();

//
// HANDLE ROUTE
//
handleRoute(app);

//
// RUN SERVICES
//
// Legacy Websocket (backward compatible with old Kaggle)
runWebsocketService(wss, HOST, PORT);

// V2 Websocket Services (new paths)
runCameraWsService(cameraWss);   // Path: /ws/camera
runKaggleWsService(kaggleWss);   // Path: /ws/kaggle

// MQTT
runMqttService();

//
// ERROR HANDLER
//
app.use(HandleErrorService.middleware);

//
// START SERVER
//
// Use httpServer.listen (which now has both ws and socket.io attached)
httpServer.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
  console.log(`WebSocket Server is listening on ws://${HOST}:${PORT}`);
});

cronService.startAllJobs();

export { wss, httpServer, HOST, PORT, io };
