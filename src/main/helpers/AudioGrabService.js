/*
 * @Author: tanghaixiang@xindong.com
 * @Date: 2019-07-22 17:18:34
 * @Last Modified by: tanghaixiang@xindong.com
 * @Last Modified time: 2019-07-23 09:44:49
 */

import { EventEmitter } from 'events';
import { splayerx } from 'electron';

export default class AudioGrabService extends EventEmitter {
  constructor() {
    super();
    this.mediaHash = null;
    this.videoSrc = null;
    this.audioId = 0;
    this.pts = '0';
    this.audioChannel = 0;
    this.rate = 16000;
    this.queue = [];
    this._count = 0;
    this.grabTime = 0;
    this.ipc = null;
    this.status = 0; // 0 grab, 1 stop
  }

  start(data) {
    if (this.queue) {
      this.queue.push(data);
    } else {
      this.queue = [data];
    }
    if (this.queue.length === 1) {
      const job = this.queue.shift();
      if (job) {
        this.startJob(job);
      }
    }
  }

  startJob(data) {
    this.videoSrc = data.videoSrc;
    this.audioId = data.audioId;
    this.pts = '0';
    this._count = 0;
    this.grabTime = 0;
    this.status = 0;
    this.grabAudio();
  }

  grabAudio() {
    const {
      videoSrc, pts, audioChannel, rate, handleCallBack, audioId,
    } = this;
    splayerx.grabAudioFrame(
      videoSrc, // 需要提取音频的视频文件路径
      `${pts}`, // seek位置
      audioId, // 音轨
      audioChannel, // 需要提取的声道, [1,8] 0代表提取所有声道
      1, // 重采样的声道[1,8] 1代表单声道
      rate, // 采样频率
      1, // 采样存储格式 0 代表 AV_SAMPLE_FMT_U8
      200, // 一次性待提取的帧数
      handleCallBack.bind(this),
    );
  }

  handleCallBack(err, framebuf, framedata) {
    if (this.status === 1) return;
    if (err !== 'EOF' && framedata && framebuf) {
      this._count += 1;
      const s = framedata.split(',');
      this.pts = s[0];
      this.grabTime += (Number(s[3]) / this.rate);
      this.emit('data', framebuf, false, this.grabTime);
    } else if (err === 'EOF') {
      this._count += 1;
      this.emit('data', framebuf, true);
    } else {
      // TODO 处理grabAudioFrame error ，有些视频直接不能，就返回error
      setTimeout(() => {
        this.grabAudio();
      }, 20);
    }
  }

  next() {
    // empty
    this.grabAudio();
  }

  stop() {
    this.pts = '0';
    this.status = 1;
    splayerx.stopGrabAudioFrame();
  }
}

export const audioGrabService = new AudioGrabService();
