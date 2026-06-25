import { ChannelConfig, ChannelId } from '../types';

export const CHANNELS: Record<ChannelId, ChannelConfig> = {
  tradeIn: {
    id: 'tradeIn',
    name: '京东换新',
    shortName: '换新',
    storageKey: 'trade_in',
    targetCompetitor: 'tm',
    subsidyMode: 'seriesThreshold',
    linearCostMode: 'tradeIn',
    competitivenessScope: 'all',
    channelSalesLabel: '手机安卓近30天京东换新渠道销售额'
  },
  selfOperated: {
    id: 'selfOperated',
    name: '自营',
    shortName: '自营',
    storageKey: 'self_operated',
    targetCompetitor: 'zz',
    subsidyMode: 'generalThreshold',
    linearCostMode: 'selfOperated',
    competitivenessScope: 'zzOnly',
    channelSalesLabel: '手机安卓近30天自营渠道销售额'
  }
};

export const DEFAULT_CHANNEL_ID: ChannelId = 'tradeIn';

