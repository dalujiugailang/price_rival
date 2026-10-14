export function registerRiskOcr(app, access, {url=process.env.RISK_OCR_URL, fetcher=fetch}={}) {
 let busy=false;
 app.post('/api/tradein-risk/ocr',access,async(req,res)=>{
  if(req.authUser.role!=='admin')return res.status(403).json({error:'仅管理员可以识别截图'});
  const image=req.body?.image;
  if(typeof image!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))return res.status(400).json({error:'请上传PNG、JPG或WebP截图'});
  if(image.length>14000000)return res.status(413).json({error:'截图请小于10MB'});
  if(!url)return res.status(503).json({error:'OCR服务尚未配置，可使用粘贴文字解析'});
  if(busy)return res.status(429).json({error:'正在识别其他截图，请稍后重试'});
  busy=true;
  try {
   const response=await fetcher(url+'/recognize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)return res.status(response.status===429?429:503).json({error:'OCR服务暂不可用，请稍后重试'});
   const result=await response.json();
   if(!Array.isArray(result.lines))throw Error('invalid response');
   res.json({lines:result.lines,durationMs:result.durationMs});
  } catch(e){res.status(503).json({error:'截图识别失败或超时，可使用粘贴文字解析'});} finally {busy=false;}
 });
}
