import React from 'react';
import { ArrowBigDownDash } from 'lucide-react';
import { sourceFileUrl } from '../api';

export default function SourceFileDownloadLink({ sourceFileId, fileName, showLabel = false, className = '' }: {
  sourceFileId: string;
  fileName: string;
  showLabel?: boolean;
  className?: string;
}) {
  return <a
    className={`inline-flex h-7 shrink-0 items-center justify-center text-[#777] hover:text-[#555] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#777] ${showLabel ? 'gap-1 rounded px-2 font-medium hover:bg-[#F0EFEC]' : 'w-7'} ${className}`}
    href={sourceFileUrl(sourceFileId)}
    download
    title={`下载 ${fileName}`}
    aria-label={`下载 ${fileName}`}
  ><ArrowBigDownDash className="h-4 w-4" aria-hidden="true" />{showLabel && <span>下载</span>}</a>;
}
