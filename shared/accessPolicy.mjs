export const ACCESS_CHANNELS = [
  { id: 'tradeIn', name: '京东换新' },
  { id: 'selfOperated', name: '京东自营' }
];
export const ACCESS_PAGES = [
  { id: 'workspace', name: '追价工作台' }, { id: 'upload', name: '数据源' },
  { id: 'history', name: '历史' }, { id: 'competitiveness', name: '竞争力走势' },
  { id: 'tmHandGap', name: '追后到手高出TM', selfName: '追后AHS高出ZZ' },
  { id: 'audit', name: '操作日志' }
];
export const ALL_ACCESS_SCOPES = ACCESS_CHANNELS.flatMap(channel => ACCESS_PAGES.map(page => `${channel.id}.${page.id}`));
export const DEFAULT_VIEWER_SCOPES = ['tradeIn.workspace', 'tradeIn.competitiveness', 'tradeIn.tmHandGap'];
export const isEditor = user => user?.role === 'admin' || user?.role === 'editor';
export const canAccess = (user, channel, page) => (
  ALL_ACCESS_SCOPES.includes(`${channel}.${page}`)
  && user?.enabled !== false
  && (user?.role === 'admin' || user?.scopes?.includes(`${channel}.${page}`) === true)
);
export const canEdit = (user, channel, page) => isEditor(user) && canAccess(user, channel, page);
export const accessibleChannels = user => ACCESS_CHANNELS.filter(channel => ACCESS_PAGES.some(page => canAccess(user, channel.id, page.id)));

export const validateAccess = ({ role, scopes, enabled }) => {
  if (!['admin', 'editor', 'viewer'].includes(role)) throw new Error('权限类型无效');
  if (typeof enabled !== 'boolean') throw new Error('启用状态无效');
  if (!Array.isArray(scopes) || scopes.some(scope => !ALL_ACCESS_SCOPES.includes(scope))) throw new Error('查看范围无效');
  const normalized = ALL_ACCESS_SCOPES.filter(scope => scopes.includes(scope));
  if (enabled && normalized.length === 0) throw new Error('启用成员至少需要一个查看页面');
  return { role, enabled, scopes: role === 'admin' ? [...ALL_ACCESS_SCOPES] : normalized };
};
