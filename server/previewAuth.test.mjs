import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from './auth.mjs';

test('disabling development bypass rejects its old sessions, even with an enabled matching member', () => {
  const member = {enabled: true, name: 'test', role: 'admin', scopes: [], version: 1};
  const auth = createAuth({db: {initializeAccess() {}, getSession: () => ({openId: 'dev-local-user', loginType: 'development'}), getMember: () => member}, env: {NODE_ENV: 'development', AUTH_DEV_BYPASS: 'false'}, appUrl: 'http://127.0.0.1:4001'});
  assert.equal(auth.devLoginEnabled, false);
  assert.equal(auth.getUser({headers: {cookie: 'price_rival_session=old-development-token'}}), null);
});

test('Feishu sessions continue to use the member access policy when development bypass is disabled', () => {
  const member = {enabled: true, name: '飞书用户', role: 'editor', scopes: ['tradeIn.workspace'], version: 2};
  const auth = createAuth({db: {initializeAccess() {}, getSession: () => ({openId: 'feishu-user', loginType: 'feishu'}), getMember: () => member}, env: {NODE_ENV: 'development', AUTH_DEV_BYPASS: 'false'}, appUrl: 'http://127.0.0.1:4001'});
  assert.equal(auth.getUser({headers: {cookie: 'price_rival_session=feishu-token'}}).loginType, 'feishu');
  assert.equal(auth.getUser({headers: {cookie: 'price_rival_session=feishu-token'}}).accessVersion, 2);
});
