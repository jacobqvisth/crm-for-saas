'use client';

import { Suspense } from 'react';
import { PipelineBoard } from '@/components/deals/pipeline-board';

export default function DealsPage() {
  return (
    <div className="h-[calc(100vh-0px)] flex flex-col">
      <PipelineBoard />
    </div>
  );
}
