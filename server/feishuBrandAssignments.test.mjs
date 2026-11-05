import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FEISHU_BRAND_ASSIGNMENTS,resolveBrandAssignments} from '../shared/feishuBrandAssignments.mjs';
import {filterCompetitivenessProducts} from '../shared/competitivenessScope.mjs';
test('brand ownership is exact, each recipient is uniquely matched and enabled',()=>{
 assert.deepEqual(FEISHU_BRAND_ASSIGNMENTS,[{name:'朱沛佳',brands:['华为','vivo']},{name:'王芊',brands:['小米','iQOO']},{name:'闻德芸',brands:['OPPO','一加','realme']},{name:'刘佳林',brands:['荣耀','三星']},{name:'曾忠中',brands:['努比亚','摩托罗拉']}]);
 const members=FEISHU_BRAND_ASSIGNMENTS.map((a,i)=>({name:a.name,openId:`ou_${i}`,enabled:true}));
 assert.ok(resolveBrandAssignments(members).every(a=>a.recipient));
 assert.equal(resolveBrandAssignments([...members,members[0]])[0].recipient,null);
 assert.equal(resolveBrandAssignments(members.map(m=>({...m,enabled:false})))[0].recipient,null);
 assert.equal(filterCompetitivenessProducts([{brand:'realme'},{brand:'OPPO'}],'真我').length,1);
});
