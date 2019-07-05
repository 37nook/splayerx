import { LanguageCode, normalizeCode } from '@/libs/language';
import { MediaTranslationResponse } from 'sagi-api/translation/v1/translation_pb';
import Sagi from '@/libs/sagi';
import { Origin, EntityGenerator, Type, Format } from '@/interfaces/ISubtitle';
import { cloneDeep } from 'lodash';

export type TranscriptInfo = MediaTranslationResponse.TranscriptInfo.AsObject;

interface OnlineOrigin extends Origin {
  type: Type.Online;
  source: string;
}
export class OnlineGenerator implements EntityGenerator {
  private origin: OnlineOrigin;
  private language: LanguageCode;
  readonly ranking: number;
  private delayInSeconds: number;
  constructor(transcriptInfo: TranscriptInfo) {
    this.origin = {
      type: Type.Online,
      source: transcriptInfo.transcriptIdentity
    };
    this.language = normalizeCode(transcriptInfo.languageCode);
    this.ranking = transcriptInfo.ranking;
    this.delayInSeconds = transcriptInfo.delay / 1000;
  }

  async getType() { return Type.Online; }

  async getSource() { return cloneDeep(this.origin); }
  async getLanguage() {
    return this.language;
  }
  async getDelay() { return this.delayInSeconds; }
  async getFormat() { return Format.Sagi; }
  async getHash() { return this.origin.source; }

  async getPayload() {
    return Sagi.getTranscript({ transcriptIdentity: this.origin.source, startTime: 0 });
  }
}
