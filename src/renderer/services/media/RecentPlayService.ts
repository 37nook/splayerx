import IRecentPlay, { LandingViewDisplayInfo } from '@/interfaces/IRecentPlay';
import { mediaStorageService } from '@/services/storage/MediaStorageService';
import { basename, extname } from 'path';
import { playInfoStorageService } from '@/services/storage/PlayInfoStorageService';
import { info } from '@/libs/DataBase';
import { mediaQuickHash } from '@/libs/utils';
import { filePathToUrl } from '@/helpers/path';
export default class RecentPlayService implements IRecentPlay {
  constructor() {
  }
  async getRecords(): Promise<LandingViewDisplayInfo[]> {
    const recentPlayedResults = await playInfoStorageService.getAllRecentPlayed();
    const coverVideos = await Promise.all(
      recentPlayedResults.map(async (value) => {
        const { items, playedIndex, id } = value;  
        const coverVideoId = items[playedIndex] as number;
        const mediaItem = await info.getValueByKey('media-item', coverVideoId);

        return {
          ...mediaItem,
          id,
          playedIndex,
          playlistLength: items.length,
        };
      }));
    const getBasename = (path: string) => basename(path, extname(path));
    const results: LandingViewDisplayInfo[] = await Promise.all(
      coverVideos.map(async (item): Promise<LandingViewDisplayInfo> => {
        const { lastPlayedTime, duration, path, playedIndex, playlistLength, shortCut, id } = item;
        const percentage = (lastPlayedTime / duration) * 100;
        let backgroundURL;

        if (duration - lastPlayedTime < 5) {
          const mediaHash = await mediaQuickHash(path);
          const coverSrc = await mediaStorageService.getImageBy(mediaHash, 'cover');
          backgroundURL = `url("${filePathToUrl(coverSrc as string)}")`;
        } else {
          backgroundURL = `url("${shortCut}")`          
        }

        const basename = getBasename(item.path);
        return {
          id,
          basename,
          lastPlayedTime,
          duration,
          percentage,
          path,
          backgroundURL,
          playedIndex,
          playlistLength,
        };
      }));
    return results.splice(0, 9);
  }
}

export const recentPlayService = new RecentPlayService();