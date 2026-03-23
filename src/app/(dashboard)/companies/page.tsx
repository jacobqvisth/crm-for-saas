import { Suspense } from 'react';
import { CompaniesPageClient } from '@/components/companies/companies-page-client';

export default function CompaniesPage() {
  return (
    <Suspense>
      <CompaniesPageClient />
    </Suspense>
  );
}
