import { Suspense } from 'react';
import { ListTable } from '@/components/lists/list-table';

export default function ListsPage() {
  return (
    <Suspense>
      <ListTable />
    </Suspense>
  );
}
