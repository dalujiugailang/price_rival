import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuth } from './auth.mjs';

test('message recipient accepts same-app account with redacted name only for known enabled members', async()=>{
 const original=globalThis.fetch;const id='ou_recipient';let contact={open_id:id};let enabled=true, known=true, remembers=0, apiCode=0;
 globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('tenant_access_token')?{code:0,tenant_access_token:'test-token'}:{code:apiCode,msg:apiCode?'denied':'success',data:{user:contact}}});
 const auth=createAuth({db:{getMember:()=>known?{openId:id,name:'陈誉钧',department:'回收策略部',enabled}:null,getProfile:()=>({name:'untrusted cached name'}),rememberProfile:()=>remembers++},env:{FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test'},appUrl:'http://localhost'});
 try {
  await assert.rejects(auth.lookupDirectoryUser(id),/未提供姓名/,'permission-management lookup must still require a live name');
  assert.deepEqual(await auth.lookupMessageRecipient(id),{openId:id,name:'陈誉钧',department:'回收策略部',nameVerified:false,nameSource:'access_member'});
  assert.equal(remembers,0,'redacted contact data must not refresh the directory as if newly verified');
  known=false;await assert.rejects(auth.lookupMessageRecipient(id),/未提供姓名/,'cached directory alone cannot authorize unnamed account');
  known=true;enabled=false;await assert.rejects(auth.lookupMessageRecipient(id),/停用/);enabled=true;
  contact={open_id:'ou_different'};await assert.rejects(auth.lookupMessageRecipient(id),/不匹配/);
  contact={open_id:id,status:{is_resigned:true}};await assert.rejects(auth.lookupMessageRecipient(id),/离职/);
  contact={open_id:id};apiCode=99991672;await assert.rejects(auth.lookupMessageRecipient(id),/denied/,'API failures must not fall back to stored members');apiCode=0;
  contact={open_id:id,name:'飞书实时姓名'};const live=await auth.lookupMessageRecipient(id);assert.equal(live.name,'飞书实时姓名');assert.equal(live.nameVerified,true);assert.equal(remembers,1);
 } finally {globalThis.fetch=original;}
});
