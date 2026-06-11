import type { Tables } from '@/lib/database.types';

export type Company = Tables<'companies'>;
export type Contact = Tables<'contacts'>;
export type Activity = Tables<'activities'>;
export type Subscription = Tables<'subscriptions'>;
export type UsageEvent = Tables<'usage_events'>;
export type DiscoveredShop = Tables<'discovered_shops'>;

export type CompanyRef = { id: string; name: string };

export type TabId = 'activity' | 'contacts' | 'statuses' | 'subscriptions' | 'usage';

export const INDUSTRIES = [
  'Technology', 'Healthcare', 'Finance', 'Education', 'Manufacturing',
  'Retail', 'Real Estate', 'Media', 'Consulting', 'Legal', 'Other',
] as const;

export const CATEGORIES = [
  'auto repair', 'tire shop', 'bodywork', 'car wash', 'inspection', 'glass repair', 'other',
] as const;
