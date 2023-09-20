"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const axios_1 = __importDefault(require("axios"));
const commander_1 = require("commander");
const progress_1 = __importDefault(require("progress"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const rimraf_1 = __importDefault(require("rimraf"));
commander_1.program.requiredOption('-b, --bv <string>', 'BV id');
commander_1.program.requiredOption('-c, --cookie <number>', 'SESSDATA','');
commander_1.program.requiredOption('-d, --directory <string>', 'Output directory', './output');
commander_1.program.requiredOption('-a, --audio', 'download audio only',false);
commander_1.program.requiredOption('-e,--cache_directory <string>', 'Output directory','');
commander_1.program.parse(process.argv);
const userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.122 Safari/537.36`;
let directory = './output';
let BVID;
let SESSDATA;
let videoData;
let audio_flag;
let cache_path;
const values = commander_1.program.opts();
if (values.bv) {
    BVID = values.bv;
}
if (values.cookie) {
    SESSDATA = decodeURI(values.cookie);
}
if (values.directory) {
    directory = (0, path_1.join)(values.directory);
}
if (values.audio) {
    audio_flag = values.audio;
}
if (values.cache_path) {
    cache_path = values.cache_path;
}
console.log('Input config:');
console.table({
    BV: BVID,
    SESSDATA: SESSDATA,
    Directory: directory ? (0, path_1.resolve)(directory) : ''
});
async function getCurrentUserData() {
    const result = await axios_1.default.get('https://api.bilibili.com/x/web-interface/nav', {
        headers: {
            Cookie: `SESSDATA=${SESSDATA || ''}`,
            'User-Agent': userAgent
        }
    });
    if (result.data.code === 0) {
        console.log('Current user:');
        console.table({
            id: result.data.data.mid,
            name: result.data.data.uname,
            isVip: result.data.data.vipStatus === 1
        });
    }
    else {
        throw new Error(`Error getting user information`);
    }
}
async function getVideoData() {
    const result = await axios_1.default.get('https://api.bilibili.com/x/web-interface/view', {
        params: {
            bvid: BVID
        },
        headers: {
            Cookie: `SESSDATA=${SESSDATA || ''}`,
            'User-Agent': userAgent
        }
    });
    if (result.data.code === 0) {
        let info = {
            BV: result.data.data.bvid,
            AV: `AV${result.data.data.aid}`,
            Title: result.data.data.title,
            // desc: result.data.data.desc
        };
        for (const [index, item] of result.data.data.pages.entries()) {
            info[`Part-${index + 1}`] = item.part;
        }
        console.log('Video data:');
        console.table(info);
        return result.data.data;
    }
    else {
        throw new Error(`Error getting video data`);
    }
}
class BaseStream {
    constructor(from, result, message, quality, format, timelength, accept_format, accept_description, accept_quality, video_codecid, seek_param, seek_type) {
        this.from = from;
        this.result = result;
        this.message = message;
        this.quality = quality;
        this.format = format;
        this.timelength = timelength;
        this.accept_format = accept_format;
        this.accept_description = accept_description;
        this.accept_quality = accept_quality;
        this.video_codecid = video_codecid;
        this.seek_param = seek_param;
        this.seek_type = seek_type;
    }
}
class DashStream {
    constructor(from, result, message, quality, format, timelength, accept_format, accept_description, accept_quality, video_codecid, seek_param, seek_type, dash) {
        this.from = from;
        this.result = result;
        this.message = message;
        this.quality = quality;
        this.format = format;
        this.timelength = timelength;
        this.accept_format = accept_format;
        this.accept_description = accept_description;
        this.accept_quality = accept_quality;
        this.video_codecid = video_codecid;
        this.seek_param = seek_param;
        this.seek_type = seek_type;
        this.dash = dash;
    }
    get stream() {
        return {
            video: this.dash.video.sort((a, b) => b.id - a.id)[0],
            audio: this.dash.audio.sort((a, b) => b.id - a.id)[0]
        };
    }
}
class FlvStream {
    constructor(from, result, message, quality, format, timelength, accept_format, accept_description, accept_quality, video_codecid, seek_param, seek_type, durl) {
        this.from = from;
        this.result = result;
        this.message = message;
        this.quality = quality;
        this.format = format;
        this.timelength = timelength;
        this.accept_format = accept_format;
        this.accept_description = accept_description;
        this.accept_quality = accept_quality;
        this.video_codecid = video_codecid;
        this.seek_param = seek_param;
        this.seek_type = seek_type;
        this.durl = durl;
    }
}
async function getAcceptQuality(cid) {
    const result = await axios_1.default.get('https://api.bilibili.com/x/player/wbi/playurl', {
        params: {
            bvid: BVID,
            cid,
            fourk: 1,
            fnval: 4048
        },
        headers: {
            Cookie: `SESSDATA=${SESSDATA || ''}`,
            'User-Agent': userAgent
        }
    });
    if (result.data.code === 0) {
        return result.data.data.accept_quality.sort((a, b) => b - a);
    }
    else {
        throw new Error(`Failed to obtain video information`);
    }
}
async function getVideoUrl(cid, qualityId) {
    const result = await axios_1.default.get('https://api.bilibili.com/x/player/wbi/playurl', {
        params: {
            bvid: BVID,
            cid,
            fnval: 4048,
            qn: qualityId,
            fourk: 1
        },
        headers: {
            Cookie: `SESSDATA=${SESSDATA || ''}`,
            'User-Agent': userAgent
        }
    });
    if (result.data.code === 0) {
        const _data = result.data.data;
        const acceptFormat = _data.accept_format.split(',');
        if ((acceptFormat.includes('mp4') || acceptFormat.includes('hdflv2')) || Object.keys(_data).includes('dash')) {
            return new DashStream(_data.from, _data.result, _data.message, _data.quality, _data.format, _data.timelength, _data.accept_format, _data.accept_description, _data.accept_quality, _data.video_codecid, _data.seek_param, _data.seek_type, _data.dash);
        }
        else {
            return new FlvStream(_data.from, _data.result, _data.message, _data.quality, _data.format, _data.timelength, _data.accept_format, _data.accept_description, _data.accept_quality, _data.video_codecid, _data.seek_param, _data.seek_type, _data.durl);
        }
    }
    else {
        throw new Error(`Error getting video download link`);
    }
}
async function download(part, url, type) {
    const response = await axios_1.default.get(url, {
        responseType: 'stream',
        headers: {
            'User-Agent': userAgent,
            'Referer': `https://www.bilibili.com/video/${BVID}`
        }
    });
    let downloaded = 0;
    const contentType = type || String(response.headers['content-type']);
    const total = Number(response.headers['content-length']);
    const filePath = (0, path_1.join)(__dirname, '/tmp', `${part.cid}-${total}`);
    console.log('filePath ',filePath)
    const bar = new progress_1.default(`${contentType} [:bar] :percent :downloaded/:length`, {
        width: 30,
        total: total
    });
    response.data.pipe((0, fs_1.createWriteStream)(filePath));
    return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
            downloaded += chunk.length;
            bar.tick(chunk.length, {
                downloaded: transform(downloaded),
                length: transform(total)
            });
        });
        response.data.on('end', () => resolve(filePath));
        response.data.on('error', (err) => reject(err));
    });
}
function convert(fileName, part, paths) {
    return new Promise((resolve, reject) => {
        if (paths.length <= 0) {
            return;
        }
        (0, fs_1.mkdirSync)((0, path_1.join)(directory), { recursive: true });
        const command = (0, fluent_ffmpeg_1.default)();
        for (const item of paths) {
            command.mergeAdd(item);
        }
        command.videoCodec(`copy`);
        command.audioCodec(`copy`);
        command.output((0, path_1.join)(directory, `${fileName}_${BVID}_${normalizeName(part.part)}.mkv`));
        command.on('start', () => {
            console.log(`Convert start`);
        });
        command.on('error', err => {
            for (const item of paths) {
                rimraf_1.default.sync(item);
            }
            reject(err);
        });
        command.on('end', () => {
            for (const item of paths) {
                rimraf_1.default.sync(item);
            }
            console.log(`Convert complete`);
            resolve();
        });
        command.run();
    });
}
function transform(value) {
    if (!value || value <= 0) {
        return '0 bytes';
    }
    const s = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const e = Math.floor(Math.log(value) / Math.log(1024));
    return `${(value / Math.pow(1024, Math.floor(e))).toFixed(2)}${s[e]}`;
}
function normalizeName(str) {
    str = str.replace(/(\?|\*)/g, '');
    str = str.replace(/(\/|\|\/)/g, ' ');
    str = str.replace(/:/g, '-');
    str = str.replace(/"/g, '\`');
    str = str.replace(/</g, '(');
    str = str.replace(/>/g, ')');
    return str;
}
async function main() {
    if (!BVID) {
        return;
    }
    (0, fs_1.mkdirSync)((0, path_1.join)(__dirname, '/tmp'), { recursive: true });
    await getCurrentUserData();
    videoData = await getVideoData();
    for (const item of videoData.pages) {
        const qualityArray = await getAcceptQuality(item.cid);
        const stream = await getVideoUrl(item.cid, qualityArray[0]);
        const paths = [];
        console.log(`Part: ${item.page}`);
        console.log(`Name: ${item.part}`);
        if (stream instanceof DashStream) {
		if ( audio_flag ){
			const audioPath = await download(item, stream.stream.audio.baseUrl, stream.dash.audio[0].mimeType);
			paths.push(audioPath);
			console.log(`Task complete`);
		}
		else {
			const videoPath = await download(item, stream.stream.video.baseUrl, stream.dash.video[0].mimeType);
			const audioPath = await download(item, stream.stream.audio.baseUrl, stream.dash.audio[0].mimeType);
			paths.push(videoPath);
			paths.push(audioPath);
		}

        }
        if (stream instanceof FlvStream) {
            const filePath = await download(item, stream.durl[0].url);
            paths.push(filePath);
        }
        await convert(normalizeName(videoData.title), item, paths);
    }
    rimraf_1.default.sync((0, path_1.join)(__dirname, '/tmp'));
    console.log(`Task complete`);
}
main();
//# sourceMappingURL=bilibili.js.map
