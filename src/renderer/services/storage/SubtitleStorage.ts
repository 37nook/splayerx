import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { LanguageCode, normalizeCode } from '@/libs/language';
import { RECENT_OBJECT_STORE_NAME, VIDEO_OBJECT_STORE_NAME, DATADB_NAME, INFO_DATABASE_NAME, INFODB_VERSION } from '@/constants';
import { MediaItem, PlaylistItem, SubtitlePreference as oldPreference } from '@/interfaces/IDB';
import { Entity, EntityGenerator, Type, Format, Origin, SubtitleControlListItem } from '@/interfaces/ISubtitle';
import { StoredSubtitle, StoredSubtitleItem, SubtitlePreference, SelectedSubtitle } from '@/interfaces/ISubtitleStorage';
import { unionWith, uniqWith, remove, isEqual, get, zip, union, flatMap, some } from 'lodash';
import Sagi from '@/libs/sagi';
import { loadLocalFile, pathToFormat } from '../subtitle/utils';
import { embeddedSrcLoader } from '../subtitle/loaders/embedded';

interface DataDBV2 extends DBSchema {
  'subtitles': {
    key: string;
    value: StoredSubtitle;
  };
  'preferences': {
    key: number;
    value: SubtitlePreference;
    indexes: {
      'byPlaylist': number,
      'byMediaItem': string,
    },
  };
}

interface AddSubtitleOptions {
  source: Origin;
  hash: string;
  format: Format;
  language: LanguageCode;
}
interface RemoveSubtitleOptions {
  source: Origin;
  hash: string;
}

class SubtitleDataBase {
  private db: IDBPDatabase<DataDBV2>;
  private async getDb() {
    return this.db ? this.db : this.db = await openDB<DataDBV2>(
      DATADB_NAME,
      3,
      {
        async upgrade(db, version) {
          if (version > 0 && version < 3) {
            db.deleteObjectStore('subtitles');
          }
          db.createObjectStore('subtitles', { keyPath: 'hash' });
          const preferenceStore = db.createObjectStore('preferences', { autoIncrement: true });
          preferenceStore.createIndex('byPlaylist', 'playlistId');
          preferenceStore.createIndex('byMediaItem', 'mediaId');
        }
      },
    );
  }

  async retrieveSubtitle(hash: string) {
    return (await this.getDb())
      .transaction('subtitles', 'readonly')
      .objectStore('subtitles')
      .get(hash);
  }
  async addSubtitle(subtitle: AddSubtitleOptions) {
    const objectStore = (await this.getDb())
      .transaction('subtitles', 'readwrite')
      .objectStore('subtitles');
    const storedSubtitle = await objectStore.get(subtitle.hash);
    if (!storedSubtitle) {
      return objectStore.add({
        ...subtitle,
        source: [subtitle.source],
      });
    }
    return objectStore.put({
      ...subtitle,
      source: uniqWith(storedSubtitle.source.concat(subtitle.source), isEqual),
    });
  }
  async removeSubtitle(subtitle: RemoveSubtitleOptions) {
    const objectStore = (await this.getDb())
      .transaction('subtitles', 'readwrite')
      .objectStore('subtitles');
    const storedSubtitle = await objectStore.get(subtitle.hash);
    if (storedSubtitle) {
      remove(storedSubtitle.source, storedSource => isEqual(storedSource, subtitle.source));
      if (!storedSubtitle.source.length) {
        return objectStore.delete(subtitle.hash);
      } else {
        return objectStore.put({ ...storedSubtitle });
      }
    }
  }

  async retrieveSubtitlePreference(playlistId: number, mediaItemId: string) {
    let cursor = await ((await this.getDb())
      .transaction('preferences', 'readonly')
      .objectStore('preferences')
      .openCursor());
    while (cursor) {
      if (cursor.value.playlistId === playlistId && cursor.value.mediaId === mediaItemId) return cursor.value;
      cursor = await cursor.continue();
    }
  }
  private generateDefaultPreference(playlistId: number, mediaItemId: string): SubtitlePreference {
    return {
      playlistId, mediaId: mediaItemId,
      language: {
        primary: LanguageCode.Default,
        secondary: LanguageCode.Default,
      },
      list: [],
      selected: {
        primary: { hash: '' },
        secondary: { hash: '' },
      },
    };
  }
  async retrieveSubtitleList(playlistId: number, mediaItemId: string) {
    const preference =  await this.retrieveSubtitlePreference(playlistId, mediaItemId);
    return preference ? preference.list : [];
  }
  async addSubtitleItemsToList(playlistId: number, mediaItemId: string, subtitles: StoredSubtitleItem[]) {
    subtitles = uniqWith(subtitles, ({ hash: hash1, source: source1 }, { hash: hash2, source: source2 }) => hash1 === hash2 && isEqual(source1, source2));
    const objectStore = (await this.getDb())
      .transaction('preferences', 'readwrite')
      .objectStore('preferences');
    let preference;
    let key;
    let cursor = await objectStore.openCursor();
    while (cursor && !preference && !key) {
      if (cursor.value.playlistId === playlistId && cursor.value.mediaId === mediaItemId) {
        preference = cursor.value;
        key = cursor.key;
      }
      cursor = await cursor.continue();
    }
    if (!preference) {
      return objectStore.add({
        ...this.generateDefaultPreference(playlistId, mediaItemId),
        list: subtitles,
      });
    } else {
      return objectStore.put({
        ...preference,
        list: unionWith(subtitles, preference.list, isEqual),
      }, key);
    }
  }
  async removeSubtitleItemsFromList(playlistId: number, mediaItemId: string, subtitles: StoredSubtitleItem[]) {
    subtitles = uniqWith(subtitles, ({ hash: hash1, source: source1 }, { hash: hash2, source: source2 }) => hash1 === hash2 && isEqual(source1, source2));
    const objectStore = (await this.getDb())
      .transaction('preferences', 'readwrite')
      .objectStore('preferences');
    let preference;
    let key;
    let cursor = await objectStore.openCursor();
    while (cursor && !preference && !key) {
      if (cursor.value.playlistId === playlistId && cursor.value.mediaId === mediaItemId) {
        preference = cursor.value;
        key = cursor.key;
      }
      cursor = await cursor.continue();
    }
    if (!preference) {
      return objectStore.add(this.generateDefaultPreference(playlistId, mediaItemId));
    } else {
      const { list: existedList } = preference;
      remove(existedList, sub => some(subtitles, sub));
      return objectStore.put({
        ...preference,
        list: existedList,
      }, key);
    }
  }
  async retrieveSubtitleLanguage(playlistId: number, mediaItemId: string) {
    const preference = await this.retrieveSubtitlePreference(playlistId, mediaItemId);
    return preference ? preference.language : {
      primary: LanguageCode.Default,
      secondary: LanguageCode.Default,
    };
  }
  async storeSubtitleLanguage(playlistId: number, mediaItemId: string, languageCodes: LanguageCode[]) {
    const objectStore = (await this.getDb())
      .transaction('preferences', 'readwrite')
      .objectStore('preferences');
    let preference;
    let key;
    let cursor = await objectStore.openCursor();
    while (cursor && !preference && !key) {
      if (cursor.value.playlistId === playlistId && cursor.value.mediaId === mediaItemId) {
        preference = cursor.value;
        key = cursor.key;
      }
      cursor = await cursor.continue();
    }

    if (!preference) {
      return objectStore.add({
        ...this.generateDefaultPreference(playlistId, mediaItemId),
        language: {
          primary: languageCodes[0],
          secondary: languageCodes[1],
        },
      });
    } else {
      return objectStore.put({
        ...preference,
        language: {
          primary: languageCodes[0],
          secondary: languageCodes[1],
        },
      }, key);
    }
  }
  async retrieveSelectedSubtitles(playlistId: number, mediaItemId: string) {
    const preference = await this.retrieveSubtitlePreference(playlistId, mediaItemId);
    return preference ? preference.selected : [];
  }
  async storeSelectedSubtitles(playlistId: number, mediaItemId: string, subtitles: SelectedSubtitle[]) {
    const objectStore = (await this.getDb())
      .transaction('preferences', 'readwrite')
      .objectStore('preferences');
    let preference;
    let key;
    let cursor = await objectStore.openCursor();
    while (cursor && !preference && !key) {
      if (cursor.value.playlistId === playlistId && cursor.value.mediaId === mediaItemId) {
        preference = cursor.value;
        key = cursor.key;
      }
      cursor = await cursor.continue();
    }
    if (!preference) {
      return objectStore.add({
        ...this.generateDefaultPreference(playlistId, mediaItemId),
        selected: {
          primary: subtitles[0],
          secondary: subtitles[1],
        },
      });
    } else {
      return objectStore.put({
        ...preference,
        selected: {
          primary: subtitles[0],
          secondary: subtitles[1],
        },
      }, key);
    }
  }
  async deleteSubtitlesByPlaylistId(playlistId: number) {
    const playlistStore = await (await this.getDb())
      .transaction('preferences', 'readwrite')
      .objectStore('preferences');
    let cursor = await playlistStore.openCursor();
    while (cursor) {
      if (cursor.value.playlistId === playlistId) await playlistStore.delete(cursor.key);
      cursor = await cursor.continue();
    }
  }
}

const db = new SubtitleDataBase();

export class DatabaseGenerator implements EntityGenerator {
  private constructor() {}
  private type: Type;
  async getType() { return this.type; }
  private format: Format;
  async getFormat() { return this.format; }
  private language: LanguageCode = LanguageCode.Default;
  async getLanguage() { return this.language; }
  private sources: Origin[];
  async getSource() { return this.sources[0]; }
  private storedSource: Origin;
  async getStoredSource() { return this.storedSource; }
  async getPayload() {
    const { type, source } = await this.getSource();
    switch (type) {
      case Type.Embedded:
        const embeddedSrc = await embeddedSrcLoader(
          source.videoSrc as string,
          source.streamIndex as number,
          this.format,
        );
        return loadLocalFile(embeddedSrc);
      case Type.Local:
        return loadLocalFile(source);
      case Type.Online:
        return Sagi.getTranscript({ transcriptIdentity: source, startTime: 0 });
    }
  }
  private hash: string;
  async getHash() {
    return this.hash;
  }
  static async from(storedSubtitleItem: StoredSubtitleItem) {
    const { hash, type } = storedSubtitleItem;
    const storedSubtitle = await db.retrieveSubtitle(hash);
    if (storedSubtitle) {
      const newGenerator = new DatabaseGenerator();
      newGenerator.storedSource = {
        type,
        source: storedSubtitleItem.source,
      };
      const { source, format, language } = storedSubtitle;
      newGenerator.type = type;
      newGenerator.format = format;
      newGenerator.language = language;
      newGenerator.sources = source;
      newGenerator.hash = hash;
      return newGenerator;
    }
  }
}

export async function storeSubtitle(subtitle: Entity) {
  const { source, hash, format, language } = subtitle;
  return db.addSubtitle({ source, format, language, hash });
}
export async function removeSubtitle(subtitle: Entity) {
  const { hash, source } = subtitle;
  return db.removeSubtitle({ hash, source });
}
export function retrieveSubtitlePreference(playlistId: number, mediaItemId: string) {
  return db.retrieveSubtitlePreference(playlistId, mediaItemId);
}
export function retrieveStoredSubtitleList(playlistId: number, mediaItemId: string) {
  return db.retrieveSubtitleList(playlistId, mediaItemId);
}
export function addSubtitleItemsToList(subtitles: SubtitleControlListItem[], playlistId: number, mediaItemId: string) {
  const storedSubtitles = subtitles.filter(s => s).map(({ hash, type, source }) => ({ hash, type, source }));
  return db.addSubtitleItemsToList(playlistId, mediaItemId, storedSubtitles);
}
export function removeSubtitleItemsFromList(subtitles: SubtitleControlListItem[], playlistId: number, mediaItemId: string) {
  const storedSubtitles = subtitles.filter(s => s).map(({ hash, type, source }) => ({ hash, type, source }));
  return db.removeSubtitleItemsFromList(playlistId, mediaItemId, storedSubtitles);
}
export function storeSubtitleLanguage(languageCodes: LanguageCode[], playlistId: number, mediaItemId: string) {
  return db.storeSubtitleLanguage(playlistId, mediaItemId, languageCodes);
}
export function storeSelectedSubtitles(subs: SelectedSubtitle[], playlistId: number, mediaItemId: string) {
  return db.storeSelectedSubtitles(playlistId, mediaItemId, subs);
}
export function retrieveSelectedSubtitles(playlistId: number, mediaItemId: string) {
  return db.retrieveSelectedSubtitles(playlistId, mediaItemId);
}
export function deleteSubtitlesByPlaylistId(playlistId: number) {
  return db.deleteSubtitlesByPlaylistId(playlistId);
}
