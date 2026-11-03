export const createFeishuClient = ({env=process.env, fetchImpl=fetch}={}) => {
  let cachedToken, expiresAt = 0;
  const configured = Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET);
  const call = async (path, options={}, token) => {
    const response = await fetchImpl(`https://open.feishu.cn/open-apis${path}`, {...options,
      headers:{...(token ? {authorization:`Bearer ${token}`} : {}),...options.headers},signal:AbortSignal.timeout(15000)});
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) throw Object.assign(new Error(`飞书接口失败（${payload.code || response.status}）：${String(payload.msg || '请检查应用权限和可用范围').slice(0,200)}`), {feishuCode:payload.code});
    return payload;
  };
  const token = async () => {
    if (!configured) throw new Error('飞书应用尚未配置');
    if (cachedToken && Date.now()<expiresAt) return cachedToken;
    const result = await call('/auth/v3/tenant_access_token/internal', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:env.FEISHU_APP_ID,app_secret:env.FEISHU_APP_SECRET})});
    cachedToken = result.tenant_access_token; expiresAt = Date.now() + Math.max(0,(result.expire-120))*1000;
    return cachedToken;
  };
  return {configured,
    async groups() {
      const result=[], accessToken=await token(); let page='';
      do {
        const data=(await call(`/im/v1/chats?page_size=100${page?`&page_token=${encodeURIComponent(page)}`:''}`,{},accessToken)).data;
        result.push(...(data.items || []).map(c=>({id:c.chat_id,name:c.name,type:'chat'})));
        page=data.has_more ? data.page_token : '';
      } while(page);
      return result;
    },
    async uploadImage(buffer) {
      const body = new FormData(); body.append('image_type','message');body.append('image',new Blob([buffer],{type:'image/png'}),'competitiveness.png');
      return (await call('/im/v1/images',{method:'POST',body},await token())).data.image_key;
    },
    async send(target, card, uuid) {
      return (await call(`/im/v1/messages?receive_id_type=${target.type === 'chat'?'chat_id':'open_id'}`,{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({receive_id:target.id,msg_type:'interactive',content:JSON.stringify(card),uuid})
      },await token())).data.message_id;
    }
  };
};
