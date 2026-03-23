import { CompanyDetailClient } from '@/components/companies/company-detail-client';

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanyDetailClient companyId={id} />;
}
