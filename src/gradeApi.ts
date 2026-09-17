import { GradeRequest, GradeRun, GradeSource, GradeRunSummary, GradeRunEvent } from './gradeTypes';
const root='/api/grade-expansion';
const request=async <T,>(path:string,body?:unknown):Promise<T>=>{
  const response=await fetch(`${root}${path}`,body===undefined ? undefined : {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
};
export const listGradeSources=()=>request<{sources:GradeSource[]}>('/sources');
export const getGradeSource=(id:string)=>request<{source:GradeSource}>(`/sources/${encodeURIComponent(id)}`);
export const uploadGradeSource=async(file:File,kind:'volume'|'template',periodStart='',periodEnd='')=>{
  if (file.size>18*1024*1024) throw new Error('文件超过18MB');
  const fileBase64=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();reader.onerror=()=>reject(new Error('文件读取失败'));
    reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);
  });
  return request<{source:GradeSource;reused:boolean}>('/sources',{fileName:file.name,fileBase64,kind,periodStart,periodEnd});
};
export const listGradeRuns=()=>request<{runs:Array<Pick<GradeRun,'id'|'title'|'createdAt'|'saved'>>}>('/runs');
export const getGradeRun=(id:string)=>request<{run:GradeRun}>(`/runs/${encodeURIComponent(id)}`);
export const generateGradeRun=(input:GradeRequest & {title:string;parentRunId?:string})=>request<{run:GradeRun}>('/runs',input);
export const saveGradeRun=(id:string,trackingBatchId:string)=>request<{run:GradeRun}>(`/runs/${encodeURIComponent(id)}/save`,{trackingBatchId});
export const getBatchGradeHistory=(id:string)=>request<{runs:GradeRunSummary[];events:GradeRunEvent[]}>(`/batches/${encodeURIComponent(id)}`);
export const gradeSourceUrl=(id:string)=>`${root}/sources/${encodeURIComponent(id)}/file`;
export const gradeExportUrl=(id:string)=>`${root}/runs/${encodeURIComponent(id)}/export`;
