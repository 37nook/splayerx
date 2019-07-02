/*
 * @Author: tanghaixiang@xindong.com 
 * @Date: 2019-06-20 18:03:14 
 * @Last Modified by: tanghaixiang@xindong.com
 * @Last Modified time: 2019-07-02 18:06:24
 */

// @ts-ignore
import { splayerx, ipcRenderer, Event } from 'electron';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { StreamingTranslationRequest, StreamingTranslationRequestConfig, StreamingTranslationResponse, StreamingTranslationTaskRequest, StreamingTranslationTaskResponse } from 'sagi-api/translation/v1/translation_pb';
import { TranslationClient } from 'sagi-api/translation/v1/translation_grpc_pb';
import { AITaskInfo } from '@/interfaces/IMediaStorable';
import MediaStorageService, { mediaStorageService } from '../storage/MediaStorageService';
import { TranscriptInfo } from '../subtitle';

/* eslint-disable */
const grpc = require('grpc');
/* eslint-enable */
var endpoint: string = '';
if (process.env.NODE_ENV === 'production') {
  endpoint = 'apis.sagittarius.ai:8443';
} else {
  endpoint = 'apis.stage.sagittarius.ai:8443';
}

enum Status {
  Grab = 'Grab',
  Task = 'Task',
  Error = 'Error',
  TranscriptInfo = 'TranscriptInfo',
}

type JobData = {
  mediaHash: string,
  videoSrc: string,
  audioLanguageCode: string,
  targetLanguageCode: string,
  callback?: Function,
}

declare interface AudioGrabService {
  on(event: 'grab', listener: (time: number) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'task', listener: (taskInfo: AITaskInfo) => void): this;
  on(event: 'transcriptInfo', listener: (transcriptInfo: TranscriptInfo) => void): this;
}

class AudioGrabService extends EventEmitter {
  mediaHash: string = '';
  videoSrc: string = '';
  pts: string = '0';
  audioChannel: number = 1;
  rate: number = 16000;
  audioLanguageCode: string = '';
  targetLanguageCode: string = '';
  streamClient: any = null;
  request: any = null;
  queue: [JobData];
  callback: Function;
  taskInfo?: AITaskInfo;
  startTime: number;
  grabEndTime: number;
  translationEndTime: number;
  loopTimer: any;
  grabTime: number;

  constructor(private readonly mediaStorageService: MediaStorageService) {
    super();
  }

  public send(data: JobData): AudioGrabService | null {
    this.taskInfo = this.mediaStorageService.getAsyncTaskInfo();
    if (this.taskInfo) {
      // 当前有任务在进行
      return null;
    } else {
      ipcRenderer.send('grab-audio', data);
      ipcRenderer.on('grab-audio-change', (event: Event, args: any) => {
        if (args.grabInfo) {
          switch (args.grabInfo.status) {
            case Status.Grab:
              this.emit('grab', args.grabInfo.progressTime);
              break;
            case Status.Error:
              this.emit('error', args.grabInfo.error);
              break;
            case Status.Task:
              this.emit('tasg', args.grabInfo.taskInfo);
              break;
            case Status.TranscriptInfo:
              this.emit('tasg', args.grabInfo.transcriptInfo);
              break;
            default:
              break;
          }
        }
      });
      return this;
    }
  }

  private grabAudio() {
    const {
      videoSrc, pts, audioChannel, rate, handleCallBack,
    } = this;
    splayerx.grabAudioFrame(
      videoSrc, // 需要提取音频的视频文件路径
      `${pts}`, // seek位置
      -1, // 音轨
      0, // 需要提取的声道, [1,8] 0代表提取所有声道
      audioChannel, // 重采样的声道[1,8] 1代表单声道
      rate, // 采样频率
      1, // 采样存储格式 0 代表 AV_SAMPLE_FMT_U8
      200, // 一次性待提取的帧数
      handleCallBack.bind(this),
    );
  }

  private handleCallBack(err: string, framebuf: Buffer, framedata: string) {
    if (!this.streamClient && this.taskInfo && this.taskInfo.taskId) {
      return;
    }
    if (err !== 'EOF' && framedata && framebuf) {
      // console.log(framedata);
      const s = framedata.split(',');
      this.pts = s[0];
      this.grabTime += (Number(s[3]) / this.rate);
      this.request.clearStreamingConfig();
      this.request.clearAudioContent();
      this.request.setAudioContent(framebuf);
      this.streamClient.write(this.request);
      this.callback({
        status: Status.Grab,
        progressTime: this.grabTime,
      });
      setTimeout(() => {
        this.grabAudio();
      }, 0);
    } else if (err === 'EOF') {
      this.request.clearAudioContent();
      this.request.setAudioContent(framebuf);
      this.streamClient.write(this.request);
      this.streamClient.end();
      this.streamClient = null;
      this.request = null;
      console.log('EOF');
      if (this.callback) {
        this.callback();
      }
    } else {
      console.error(err);
      setTimeout(() => {
        this.grabAudio();
      }, 20);
    }
  }

  public push(data: JobData, callback: Function) {
    data.callback = callback;
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

  private startJob(data: JobData) {
    this.mediaHash = data.mediaHash;
    this.videoSrc = data.videoSrc;
    this.audioLanguageCode = data.audioLanguageCode;
    this.targetLanguageCode = data.targetLanguageCode;
    if (data.callback) {
      this.callback = data.callback;
    }
    // create stream client
    this.streamClient = this.openClient();

    // send config
    this.request = new StreamingTranslationRequest();
    const requestConfig = new StreamingTranslationRequestConfig();
    // @ts-ignore
    const audioConfig = new global.proto.google.cloud.speech.v1
      .RecognitionConfig([1, this.rate, this.audioLanguageCode]);
    requestConfig.setStreamingConfig(audioConfig);
    requestConfig.setAudioLanguageCode(this.audioLanguageCode);
    requestConfig.setTargetLanguageCode(this.targetLanguageCode);
    requestConfig.setMediaIdentity(data.mediaHash);
    this.request.setStreamingConfig(requestConfig);
    this.streamClient.write(this.request);

    // start grab data
    this.pts = '0';
    this.grabTime = 0;
    this.grabAudio();

    this.startTime = Date.now();
  }

  private openClient(): any {
    const sslCreds = grpc.credentials.createSsl(
      // @ts-ignore
      fs.readFileSync(path.join(__static, '/certs/ca.pem')),
      // @ts-ignore
      fs.readFileSync(path.join(__static, '/certs/key.pem')),
      // @ts-ignore
      fs.readFileSync(path.join(__static, '/certs/cert.pem')),
    );
    const metadataUpdater = (_: any, cb: Function) => {
      const metadata = new grpc.Metadata();
      cb(null, metadata);
    };
    const metadataCreds = grpc.credentials.createFromMetadataGenerator(metadataUpdater);
    const combinedCreds = grpc.credentials.combineChannelCredentials(sslCreds, metadataCreds);
    const client = new TranslationClient(endpoint, combinedCreds);
    const stream = client.streamingTranslation();
    stream.on('data', this.rpcCallBack.bind(this));
    return stream;
  }

  private rpcCallBack(res: StreamingTranslationResponse, err: Error) {
    const result = res.toObject();
    if (res.hasTaskinfo()) {
      this.grabEndTime = Date.now();
      this.taskInfo = {
        mediaHash: this.mediaHash,
        ...result.taskinfo,
      } as AITaskInfo
      // if streamClient exist end my stream
      if (this.streamClient) {
        this.streamClient.end();
        this.streamClient = null;
        this.request = null;
      }
      // return task to render
      this.callback({
        status: Status.Task,
        taskInfo: this.taskInfo,
      });
      this.loopTask(this.taskInfo)
    } else if (res.hasTranscriptResult()) {
      // get Transcript Info
      // return hash to render
      this.translationEndTime = Date.now();
      this.callback({
        status: Status.TranscriptInfo,
        transcriptInfo: result.transcriptResult,
      });
      this.clearJob();
    } else if (res.hasError()) {
      // return error to render
      this.callback({
        status: Status.Error,
        error: result.error,
      });
    } else if (err) {
      this.callback({
        status: Status.Error,
        error: err,
      });
    }
    // if (res && this.queue.length > 0) {
    //   const job = this.queue.shift();
    //   if (job) {
    //     this.startJob(job);
    //   }
    // }
  }

  loopTask(taskInfo: AITaskInfo) {
    const taskId = taskInfo.taskId;
    const delay = (taskInfo.estimateTime / 2) * 1000;
    const callback = this.loopTaskCallBack.bind(this);
    this.loopTimer = setTimeout(() => {
      const sslCreds = grpc.credentials.createSsl(
        // @ts-ignore
        fs.readFileSync(path.join(__static, '/certs/ca.pem')),
        // @ts-ignore
        fs.readFileSync(path.join(__static, '/certs/key.pem')),
        // @ts-ignore
        fs.readFileSync(path.join(__static, '/certs/cert.pem')),
      );
      const metadataUpdater = (_: any, cb: Function) => {
        const metadata = new grpc.Metadata();
        cb(null, metadata);
      };
      const metadataCreds = grpc.credentials.createFromMetadataGenerator(metadataUpdater);
      const combinedCreds = grpc.credentials.combineChannelCredentials(sslCreds, metadataCreds);
      const client = new TranslationClient(endpoint, combinedCreds);
      const taskRequest = new StreamingTranslationTaskRequest();
      taskRequest.setTaskId(taskId);
      client.streamingTranslationTask(taskRequest, callback);
    }, delay);
  }

  private loopTaskCallBack(err: Error | null, res: StreamingTranslationTaskResponse) {
    const result = res.toObject();
    if (res.hasTranscriptinfo()) {
      this.translationEndTime = Date.now();
      this.callback({
        status: Status.TranscriptInfo,
        transcriptInfo: result.transcriptinfo,
      });
    } else if (res.hasTaskinfo()) {
      this.callback({
        status: Status.Task,
        taskInfo: this.taskInfo,
      });
      this.loopTask(result.taskinfo as AITaskInfo);
    } else if (res.hasError()) {
      this.callback({
        status: Status.Error,
        error: result.error,
      });
    } else if (err) {
      this.callback({
        status: Status.Error,
        error: err,
      });
    }
  }

  clearJob() {
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
    }
  }
}
export default AudioGrabService;

export const audioGrabService = new AudioGrabService(mediaStorageService);
