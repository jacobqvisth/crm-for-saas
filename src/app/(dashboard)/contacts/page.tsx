import { Suspense } from 'react';
import { ContactsPageClient } from '@/components/contacts/contacts-page-client';

export default function ContactsPage() {
  return (
    <Suspense>
      <ContactsPageClient />
    </Suspense>
  );
}
