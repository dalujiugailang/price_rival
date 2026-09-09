export const registerAccessRoutes = (app, { db, auth }) => {
  const adminOnly = (req, res, next) => {
    if (req.authUser.role === 'admin') return next();
    res.status(403).json({ success: false, error: '只有管理员可以管理人员权限' });
  };
  const fail = (res, error) => res.status(error.statusCode || 400).json({ success: false, error: error.message });
  app.get('/api/access-members', adminOnly, (_req, res) => res.json({ success: true, members: db.listMembers() }));
  app.get('/api/access-directory', adminOnly, async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query || query.length > 50) return res.status(400).json({ success: false, error: '请输入 1～50 个字的姓名或飞书账号 ID' });
    try { res.json({ success: true, ...await auth.searchDirectory(req.authUser, query) }); }
    catch (error) { fail(res, error); }
  });
  app.post('/api/access-members', adminOnly, async (req, res) => {
    try {
      const openId = String(req.body?.openId || '');
      if (!(auth.devLoginEnabled && req.authUser.loginType === 'development')) await auth.lookupDirectoryUser(openId);
      const member = db.saveMember({ ...req.body, openId }, auth.requestContext(req), true);
      res.status(201).json({ success: true, member });
    } catch (error) { fail(res, error); }
  });
  app.put('/api/access-members/:openId', adminOnly, (req, res) => {
    try { res.json({ success: true, member: db.saveMember({ ...req.body, openId: req.params.openId }, auth.requestContext(req)) }); }
    catch (error) { fail(res, error); }
  });
};
