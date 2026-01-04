import { PassThrough } from 'node:stream';

class StreamManager {
	private streams: Map<string, PassThrough> = new Map();

	/**
	 * Get or create a stream for a specific camera
	 */
	getStream(cameraId: string): PassThrough {
		if (!this.streams.has(cameraId)) {
			console.log(`[StreamManager] Creating new stream for camera: ${cameraId}`);
			const stream = new PassThrough();
			this.streams.set(cameraId, stream);

			// Cleanup on end? Usually streams stay open for server uptime.
			// But we could add idle timeout later.
		}
		return this.streams.get(cameraId)!;
	}

	/**
	 * Push data to a specific camera stream
	 */
	pushData(cameraId: string, data: Buffer) {
		const stream = this.getStream(cameraId);
		// PassThrough handles buffering automatically
		stream.push(data);
	}
}

export const streamManager = new StreamManager();
