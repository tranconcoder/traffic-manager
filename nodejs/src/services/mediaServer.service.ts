/**
 * Node Media Server Service
 * 
 * RTMP input (1935) → HLS output (8000)
 * 
 * Usage:
 * - FFmpeg outputs to: rtmp://localhost:1935/live/security_gate
 * - HLS available at: http://localhost:8000/live/security_gate/index.m3u8
 * 
 * Install: npm install node-media-server
 */

import NodeMediaServer from 'node-media-server';
import { envConfig } from '@/config/index.js';

const config = {
    rtmp: {
        port: envConfig.MEDIA_SERVER_INPUT_PORT || 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
    },
    http: {
        port: envConfig.MEDIA_SERVER_OUTPUT_PORT || 8000,
        mediaroot: './media',
        allow_origin: '*',
    },
    auth: {
        api: false,
        api_user: 'admin',
        api_pass: 'admin',
    },
    trans: {
        ffmpeg: envConfig.FFMPEG_PATH || '/usr/bin/ffmpeg',
        tasks: [
            {
                app: 'live',
                hls: true,
                hlsFlags: '[hls_time=2:hls_list_size=300:hls_flags=delete_segments]', // 300*2s = 600s = 10 mins
                hlsKeep: false, // Don't keep old HLS segments
            },
        ],
    },
};

let nms: NodeMediaServer | null = null;

export function startMediaServer(): NodeMediaServer {
    nms = new NodeMediaServer(config);

    nms.on('preConnect', (id: string, args: any) => {
        console.log('[Media Server] Client connecting:', id, args);
    });

    nms.on('postConnect', (id: string, args: any) => {
        console.log('[Media Server] Client connected:', id);
    });

    nms.on('doneConnect', (id: string, args: any) => {
        console.log('[Media Server] Client disconnected:', id);
    });

    nms.on('prePublish', (id: string, streamPath: string, args: any) => {
        console.log('[Media Server] Publishing stream:', streamPath);
    });

    nms.on('postPublish', (id: string, streamPath: string, args: any) => {
        console.log('[Media Server] Stream published:', streamPath);
        console.log(`[Media Server] HLS: http://localhost:${config.http.port}${streamPath}/index.m3u8`);
    });

    nms.on('donePublish', (id: string, streamPath: string, args: any) => {
        console.log('[Media Server] Stream ended:', streamPath);
    });

    nms.on('prePlay', (id: string, streamPath: string, args: any) => {
        console.log('[Media Server] Client playing:', streamPath);
    });

    nms.run();

    console.log('═'.repeat(60));
    console.log('[Media Server] Started');
    console.log(`  RTMP Input: rtmp://0.0.0.0:${config.rtmp.port}/live/<stream_name>`);
    console.log(`  HTTP Output: http://0.0.0.0:${config.http.port}/live/<stream_name>/index.m3u8`);
    console.log('═'.repeat(60));

    return nms;
}

export function stopMediaServer() {
    if (nms) {
        nms.stop();
        nms = null;
        console.log('[Media Server] Stopped');
    }
}

export function getMediaServerInfo() {
    return {
        rtmpPort: config.rtmp.port,
        httpPort: config.http.port,
        hlsUrl: (streamName: string) =>
            `http://localhost:${config.http.port}/live/${streamName}/index.m3u8`,
        rtmpUrl: (streamName: string) =>
            `rtmp://localhost:${config.rtmp.port}/live/${streamName}`,
    };
}

export default {
    startMediaServer,
    stopMediaServer,
    getMediaServerInfo,
};
