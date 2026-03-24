import { Suspense } from 'react';
import { ListDetailClient } from '@/components/lists/list-detail-client';

export default async function ListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <Suspense>
      <ListDetailClient listId={id} />
    </Suspense>
  );
}
