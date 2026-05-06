'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { Modal } from '@/components/ui/modal';
import type { Json } from '@/lib/database.types';

import { CompanyHero } from './detail/hero';
import { CompanySignals } from './detail/signals';
import { DiscoveryStrip } from './detail/discovery-strip';
import { AboutPanel } from './detail/about-panel';
import { EditDrawer } from './detail/edit-drawer';
import { CompanyTabs } from './detail/tabs';
import type {
  Company, Contact, Activity, Subscription, UsageEvent, DiscoveredShop,
  DealRow, CompanyRef, TabId,
} from './detail/types';

export function CompanyDetailClient({ companyId }: { companyId: string }) {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [allCompanies, setAllCompanies] = useState<CompanyRef[]>([]);
  const [childCompanies, setChildCompanies] = useState<CompanyRef[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [usageEvents, setUsageEvents] = useState<UsageEvent[]>([]);
  const [discoveredShop, setDiscoveredShop] = useState<DiscoveredShop | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('activity');
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);

      const { data: companyData } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .eq('workspace_id', workspaceId!)
        .single();

      if (cancelled) return;

      if (!companyData) {
        toast.error('Company not found');
        router.push('/companies');
        return;
      }
      setCompany(companyData);
      setCustomFields((companyData.custom_fields as Record<string, string>) || {});

      const [
        companiesRes, childRes, contactsRes, dealsRes,
        subsRes, usageRes, shopRes,
      ] = await Promise.all([
        supabase.from('companies').select('id, name')
          .eq('workspace_id', workspaceId!).neq('id', companyId).order('name'),
        supabase.from('companies').select('id, name')
          .eq('workspace_id', workspaceId!).eq('parent_company_id', companyId).order('name'),
        supabase.from('contacts').select('*')
          .eq('workspace_id', workspaceId!).eq('company_id', companyId).order('created_at', { ascending: false }),
        supabase.from('deals').select('id, name, amount, stage, owner_id, expected_close_date')
          .eq('workspace_id', workspaceId!).eq('company_id', companyId).order('created_at', { ascending: false }),
        supabase.from('subscriptions').select('*')
          .eq('workspace_id', workspaceId!).eq('company_id', companyId).order('created_at', { ascending: false }),
        supabase.from('usage_events').select('*')
          .eq('workspace_id', workspaceId!).eq('company_id', companyId).order('event_at', { ascending: false }).limit(50),
        supabase.from('discovered_shops').select('*')
          .eq('crm_company_id', companyId).order('scraped_at', { ascending: false }).limit(1).maybeSingle(),
      ]);

      if (cancelled) return;

      if (companiesRes.data) setAllCompanies(companiesRes.data);
      if (childRes.data) setChildCompanies(childRes.data);
      const contactsData = contactsRes.data ?? [];
      setContacts(contactsData);
      if (dealsRes.data) setDeals(dealsRes.data);
      if (subsRes.data) setSubscriptions(subsRes.data);
      if (usageRes.data) setUsageEvents(usageRes.data);
      if (shopRes.data) setDiscoveredShop(shopRes.data);

      // Activities depend on contact ids
      const contactIds = contactsData.map((c) => c.id);
      let activitiesQuery = supabase
        .from('activities')
        .select('*')
        .eq('workspace_id', workspaceId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (contactIds.length > 0) {
        activitiesQuery = activitiesQuery.or(
          `company_id.eq.${companyId},contact_id.in.(${contactIds.join(',')})`,
        );
      } else {
        activitiesQuery = activitiesQuery.eq('company_id', companyId);
      }
      const { data: activitiesData } = await activitiesQuery;
      if (cancelled) return;
      if (activitiesData) setActivities(activitiesData);

      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, companyId]);

  const updateField = async (field: keyof Company, value: string | number | null) => {
    if (!company || !workspaceId) return;
    const { error } = await supabase
      .from('companies')
      .update({ [field]: value } as Record<string, unknown>)
      .eq('id', company.id)
      .eq('workspace_id', workspaceId);
    if (error) {
      toast.error('Failed to update');
      return;
    }
    setCompany((prev) => (prev ? { ...prev, [field]: value } as Company : null));
  };

  const updatePatch = async (patch: Partial<Company>) => {
    if (!company || !workspaceId) return;
    const { error } = await supabase
      .from('companies')
      .update(patch as Record<string, unknown>)
      .eq('id', company.id)
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    setCompany((prev) => (prev ? { ...prev, ...patch } as Company : null));
  };

  const updateTags = async (tags: string[]) => {
    if (!company || !workspaceId) return;
    const { error } = await supabase
      .from('companies')
      .update({ tags } as Record<string, unknown>)
      .eq('id', company.id)
      .eq('workspace_id', workspaceId);
    if (error) {
      toast.error('Failed to update tags');
      return;
    }
    setCompany((prev) => (prev ? { ...prev, tags } as Company : null));
  };

  const updateCustomFields = async (fields: Record<string, string>) => {
    if (!company || !workspaceId) return;
    const { error } = await supabase
      .from('companies')
      .update({ custom_fields: fields as unknown as Json })
      .eq('id', company.id)
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    setCompany((prev) => (prev ? { ...prev, custom_fields: fields as unknown as Json } : null));
    setCustomFields(fields);
  };

  const handleDelete = async () => {
    if (!company || !workspaceId) return;
    const { error } = await supabase
      .from('companies')
      .delete()
      .eq('id', company.id)
      .eq('workspace_id', workspaceId);
    if (error) {
      toast.error('Failed to delete');
      return;
    }
    toast.success('Company deleted');
    router.push('/companies');
  };

  const goToContactsTab = () => setActiveTab('contacts');
  const goToDealsTab = () => setActiveTab('deals');
  const goToActivityTab = () => setActiveTab('activity');

  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!company) return null;

  const parentCompany = allCompanies.find((c) => c.id === company.parent_company_id);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <CompanyHero
        company={company}
        onUpdate={updateField}
        onAddContact={goToContactsTab}
        onAddDeal={goToDealsTab}
        onLogActivity={goToActivityTab}
        onDelete={() => setShowDeleteConfirm(true)}
      />

      <CompanySignals company={company} contacts={contacts} />

      {discoveredShop && <DiscoveryStrip shop={discoveredShop} />}

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="w-full lg:w-[280px] flex-shrink-0">
          <AboutPanel
            company={company}
            parentCompany={parentCompany}
            childCompanies={childCompanies}
            onEditDetails={() => setEditOpen(true)}
            onDelete={() => setShowDeleteConfirm(true)}
            onUpdateTags={updateTags}
            onUpdateNotes={(notes) => updateField('notes', notes)}
          />
        </div>

        <div className="flex-1 min-w-0">
          <CompanyTabs
            activeTab={activeTab}
            onChangeTab={setActiveTab}
            contacts={contacts}
            deals={deals}
            activities={activities}
            subscriptions={subscriptions}
            usageEvents={usageEvents}
          />
        </div>
      </div>

      <EditDrawer
        open={editOpen}
        onClose={() => setEditOpen(false)}
        company={company}
        allCompanies={allCompanies}
        customFields={customFields}
        onSave={updatePatch}
        onSaveCustomFields={updateCustomFields}
      />

      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Delete Company">
        <p className="text-sm text-slate-600 mb-4">
          Are you sure you want to delete <strong>{company.name}</strong>? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
