import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from './database.mjs';
import { provisionExclusiveFeishuPushOwner } from './provisionFeishuPushOwner.mjs';
import { ALL_ACCESS_SCOPES, canPushFeishu, canManageActionPermissions, validateAccess } from '../shared/accessPolicy.mjs';

test('push requires explicit action even for admins and still respects role and channel', () => {
 const admin={role:'admin',enabled:true,scopes:ALL_ACCESS_SCOPES};
 assert.equal(canPushFeishu(admin,'tradeIn'),false);
 assert.equal(canManageActionPermissions(admin),false);
 const owner={...admin,scopes:[...admin.scopes,'feishu.push']};
 assert.equal(canPushFeishu(owner,'tradeIn'),true);
 assert.equal(canPushFeishu({...owner,enabled:false},'tradeIn'),false);
 assert.equal(canPushFeishu({...owner,role:'viewer'},'tradeIn'),false);
 const editor={role:'editor',scopes:['feishu.push','tradeIn.workspace','tradeIn.competitiveness']};
 assert.equal(canPushFeishu(editor,'tradeIn'),true);
 assert.equal(canPushFeishu(editor,'selfOperated'),false);
 assert.equal(validateAccess({...admin,scopes:['tradeIn.history']}).scopes.includes('feishu.push'),false);
});

test('exclusive provisioning backs up and preserves pages; generic admin updates cannot grant action',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'push-permission-'));
 const file=path.join(directory,'test.sqlite');let db=createDatabase(file);
 db.initializeAccess({editors:['ou_owner','ou_admin','ou_editor'],viewers:['ou_viewer'],admins:['ou_owner','ou_admin'],profiles:{}});
 const before=db.listMembers();assert.ok(before.every(m=>!m.scopes.includes('feishu.push')));db.close();
 const result=await provisionExclusiveFeishuPushOwner(file,'ou_owner');
 assert.equal(result.granted.length,1);assert.equal(result.granted[0].open_id,'ou_owner');
 assert.equal(result.quickCheck,'ok');assert.equal(result.beforeBatchCount,result.afterBatchCount);assert.ok(existsSync(result.backupPath));
 db=createDatabase(file);
 try {
  for(const member of before) assert.deepEqual(db.getMember(member.openId).scopes.filter(s=>s!=='feishu.push'),member.scopes);
  const other=db.getMember('ou_admin'),owner=db.getMember('ou_owner'),editor=db.getMember('ou_editor');
  assert.throws(()=>db.setMemberActions({openId:other.openId,actions:['feishu.push'],version:other.version},{actor:other}),{statusCode:403});
  assert.throws(()=>db.saveMember({...editor,scopes:[...editor.scopes,'feishu.push']},{actor:other}),{statusCode:403});
  const granted=db.setMemberActions({openId:editor.openId,actions:['feishu.push'],version:editor.version},{actor:owner});
  assert.equal(canPushFeishu(granted,'tradeIn'),true);
  assert.deepEqual(granted.scopes.filter(s=>s!=='feishu.push'),editor.scopes);
  assert.throws(()=>db.setMemberActions({openId:owner.openId,actions:[],version:owner.version},{actor:owner}),{statusCode:403});
  const viewer=db.getMember('ou_viewer');
  assert.throws(()=>db.setMemberActions({openId:viewer.openId,actions:['feishu.push'],version:viewer.version},{actor:owner}));
 } finally {db.close();}
 const again=await provisionExclusiveFeishuPushOwner(file,'ou_owner');assert.equal(again.granted.length,1);
 const idempotent=await provisionExclusiveFeishuPushOwner(file,'ou_owner');assert.equal(idempotent.changes.length,0);
});
