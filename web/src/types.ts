export interface FollowLink {
  webhookId: string;
  sourceGuildId?: string;
  sourceGuildName?: string;
  sourceChannelId?: string;
  sourceChannelName?: string;
}

export interface DestinationChannelGroup {
  destinationChannelId: string;
  destinationChannelName: string;
  follows: FollowLink[];
}

export interface FollowInventoryResponse {
  guildId: string;
  guildName?: string;
  fetchedAt: string;
  destinationChannels: DestinationChannelGroup[];
}
