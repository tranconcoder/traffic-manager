import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';

console.log('FFmpeg Path:', ffmpegInstaller.path);
try {
    if (fs.existsSync(ffmpegInstaller.path)) {
        console.log('File exists');
        // Check permissions?
    } else {
        console.log('File NOT found');
    }
} catch (e) {
    console.error(e);
}
