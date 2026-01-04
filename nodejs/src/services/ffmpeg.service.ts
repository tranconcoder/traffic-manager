import Ffmpeg from 'fluent-ffmpeg';
import { streamManager } from './stream.service.js';
import {
  handleCodecData,
  handleEnd,
  handleError,
  handleProgress,
  handleStart,
} from '@/utils/ffmpeg.util.js';
import {
  FFMPEG_PATH,
  FRAMESIZE,
  RTMP_SERVER_BASE_URL,
} from '@/config/ffmpeg.config.js';

class FFmpegManager {
  private activeCommands: Map<string, Ffmpeg.FfmpegCommand> = new Map();

  /**
   * Start FFmpeg process for a camera if not already running
   * Pushes RTMP stream to Node Media Server
   */
  startStream(cameraId: string) {
    if (this.activeCommands.has(cameraId)) {
      return; // Already running
    }

    console.log(`[FFmpegManager] Starting stream for camera: ${cameraId}`);

    const inputStr = streamManager.getStream(cameraId);
    const rtmpUrl = `${RTMP_SERVER_BASE_URL}/${cameraId}`;

    const command = Ffmpeg({ priority: 0 })
      .input(inputStr)
      .inputFormat("image2pipe")
      .inputOptions([
        "-use_wallclock_as_timestamps 1",
        "-vcodec mjpeg",
      ])
      .withNoAudio()
      .outputOptions([
        "-preset fast",      // Better quality than ultrafast
        "-tune zerolatency",
        "-c:v libx264",
        "-crf 23",           // Quality level (18-28, lower = better, 23 = medium)
        "-maxrate 2000k",
        "-bufsize 4000k",
        "-vsync cfr",
        "-pix_fmt yuv420p",
        "-g 50",
        "-f flv",
        "-r 25"
      ])
      .output(rtmpUrl)
      .on("start", (cmd) => {
        console.log(`[FFmpeg] Started RTMP push to ${cameraId}: ${cmd}`);
        handleStart(cmd);
      })
      .on("codecData", handleCodecData)
      .on("progress", handleProgress)
      .on("end", () => {
        console.log(`[FFmpeg] Ended ${cameraId}`);
        this.activeCommands.delete(cameraId);
        handleEnd();
      })
      .on("error", (err) => {
        console.error(`[FFmpeg] Error ${cameraId}:`, err.message);
        this.activeCommands.delete(cameraId);
        handleError(err);
      });

    command.run();
    this.activeCommands.set(cameraId, command);
  }
}

export const ffmpegManager = new FFmpegManager();
