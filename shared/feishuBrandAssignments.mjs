// Each brand is a separate report scope; never share another owner's brand data.
export const FEISHU_BRAND_ASSIGNMENTS = [
  { name: '朱沛佳', brands: ['华为', 'vivo'] },
  { name: '王芊', brands: ['小米', 'iQOO'] },
  { name: '闻德芸', brands: ['OPPO', '一加', 'realme'] },
  { name: '刘佳林', brands: ['荣耀', '三星'] },
  { name: '曾忠中', brands: ['努比亚', '摩托罗拉'] }
];
export const resolveBrandAssignments = members => FEISHU_BRAND_ASSIGNMENTS.map(assignment => {
  const matches = members.filter(member => member.enabled && member.name === assignment.name);
  const member = matches.length === 1 ? matches[0] : null;
  return { ...assignment, recipient: member ? { id: member.openId, name: member.name, department: member.department || '', type: 'user' } : null };
});
