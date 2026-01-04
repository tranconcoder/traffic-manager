import path from 'path';
import { envConfig } from './index.js';
import { ConfigFilterVideo } from '@/types/ffmpeg.js';

import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// Bin file path
export const FFMPEG_PATH = ffmpegInstaller.path;
export const FFPROBE_PATH = envConfig.FFPROBE_PATH;

export const FRAMESIZES = {
	QCIF: '176x144',
	HQVGA: '240x176',
	_240X240: '240x240',
	QVGA: '320x240',
	CIF: '400x296',
	HVGA: '480x320',
	VGA: '640x480',
	SVGA: '800x600',
	XGA: '1024x768',
	HD: '1280x720',
};

export const FRAMESIZE = FRAMESIZES.VGA;
export const [FRAMESIZE_HEIGHT, FRAMESIZE_WIDTH] = FRAMESIZE.split('x').map(
	(x) => Number(x)
);
export const FRAME_PADDING_X = 10;
export const FRAME_PADDING_Y = 10;
export const FONTSIZE = 18;
export const LINE_MARGIN_SIZE = 3;
export const DRAWTEXT_COLOR = 'white@0.8';
export const DRAWTEXT_FONTPATH = path.join(
	import.meta.dirname,
	'./assets/fonts/CaskaydiaCoveNerdFontMono-Regular.ttf'
);
export const SECURITY_GATE_LIVE_NAME = 'security_gate';
export const MONITOR_LIVE_NAME = 'monitor';
export const RTMP_SERVER_BASE_URL = `rtmp://${envConfig.MEDIA_SERVER_HOST}:${envConfig.MEDIA_SERVER_INPUT_PORT}/live`;
export const RTMP_SECURITY_GATE_URL = `${RTMP_SERVER_BASE_URL}/${SECURITY_GATE_LIVE_NAME}`;
export const RTMP_MONITOR_URL = `${RTMP_SERVER_BASE_URL}/${MONITOR_LIVE_NAME}`;

export const timeFilterConfig: ConfigFilterVideo = {
	text: '%{localtime}',
	fontcolor: DRAWTEXT_COLOR,
	fontfile: DRAWTEXT_FONTPATH,
	fontsize: FONTSIZE,
	x: FRAME_PADDING_X,
	y: FRAME_PADDING_Y,
};
export const securityGateFilterConfig = {
	...timeFilterConfig,
	text: 'SecurityCam',
	get x() {
		return parseInt(
			FRAMESIZE_WIDTH - FONTSIZE * (19 / 30) * this.text.length + ''
		);
	},
} as ConfigFilterVideo;

export const monitorFilterConfig = {
	...timeFilterConfig,
	text: 'MonitorCam',
	get x() {
		return parseInt(
			FRAMESIZE_WIDTH - FONTSIZE * (19 / 30) * this.text.length + ''
		);
	},
} as ConfigFilterVideo;
