const NodeMediaServer = require('node-server-media');

// Simple RTMP + HTTP-FLV server (no HLS transcoding)
const config = {
    rtmp: {
        port: 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
    },
    http: {
        port: 8000,
        allow_origin: '*'
    }
    // No trans config - FLV only, no HLS files
};

var nms = new NodeMediaServer(config);
nms.run();

console.log('--- Node Media Server (FLV Only Mode) ---');
console.log('RTMP input: rtmp://localhost:1935/live/STREAM_NAME');
console.log('FLV output: http://localhost:8000/live/STREAM_NAME.flv');
