export type channelInfo = {
  channels: channelDetails[],
  availableChannels: string[],
}

export type channelDetails = {
  channel: string,
  url: string,
  icon: string,
  title: string,
  path: string,
  category: string,
}

export type category = {
  type: string,
  locale: string,
}

export interface IBrowsingChannelManager {
  getChannelInfoByCategory(category: string): channelInfo
  setChannelAvailable(channel: string, available: boolean): Promise<void>
  getAllCategories(): category[]
  getAllChannels(): Map<string, channelInfo>
  getAllAvailableChannels(): channelDetails[]
  repositionChannels(from: number, to: number): channelDetails[]
  initAvailableChannels(channels: channelDetails[]): channelDetails[]
  getDefaultChannelsByCountry(displayLanguage: string): Promise<channelDetails[]>
  addCustomizedChannel(info: channelDetails): void
  updateCustomizedChannelTitle(channel: string, title: string): void
  updateCustomizedChannel(oldChannel: string, info: channelDetails): void
  deleteCustomizedByChannel(channel: string): void
}
