import type { Tables } from '@/lib/database.types';

export type Company = Tables<'companies'> & {
  contacts_count: number;
  deals_count: number;
};

export type ColumnId =
  | 'name'
  | 'domain'
  | 'website'
  | 'phone'
  | 'city'
  | 'country'
  | 'industry'
  | 'category'
  | 'contacts_count'
  | 'deals_count'
  | 'lifecycle_stage'
  | 'customer_status'
  | 'plan'
  | 'has_account'
  | 'source'
  | 'tags'
  | 'last_active_at'
  | 'created_at'
  | 'updated_at';

export type ColumnDef = {
  id: ColumnId;
  label: string;
  default: boolean;
  sortable: boolean;
};

export const COLUMNS: ColumnDef[] = [
  { id: 'name',            label: 'Name',            default: true,  sortable: true  },
  { id: 'domain',          label: 'Domain',          default: true,  sortable: true  },
  { id: 'website',         label: 'Website',         default: false, sortable: false },
  { id: 'phone',           label: 'Phone',           default: false, sortable: false },
  { id: 'city',            label: 'City',            default: false, sortable: false },
  { id: 'country',         label: 'Country',         default: true,  sortable: true  },
  { id: 'industry',        label: 'Industry',        default: true,  sortable: true  },
  { id: 'category',        label: 'Category',        default: false, sortable: false },
  { id: 'contacts_count',  label: 'Contacts',        default: true,  sortable: false },
  { id: 'deals_count',     label: 'Deals',           default: true,  sortable: false },
  { id: 'lifecycle_stage', label: 'Lifecycle',       default: false, sortable: false },
  { id: 'customer_status', label: 'Customer status', default: false, sortable: false },
  { id: 'plan',            label: 'Plan',            default: false, sortable: false },
  { id: 'has_account',     label: 'App workshop',    default: false, sortable: false },
  { id: 'source',          label: 'Source',          default: false, sortable: false },
  { id: 'tags',            label: 'Tags',            default: false, sortable: false },
  { id: 'last_active_at',  label: 'Last active',     default: false, sortable: true  },
  { id: 'created_at',      label: 'Created',         default: true,  sortable: true  },
  { id: 'updated_at',      label: 'Updated',         default: false, sortable: false },
];

export const COLUMN_BY_ID: Record<ColumnId, ColumnDef> =
  Object.fromEntries(COLUMNS.map((c) => [c.id, c])) as Record<ColumnId, ColumnDef>;

export const DEFAULT_COLUMN_IDS: ColumnId[] = COLUMNS.filter((c) => c.default).map((c) => c.id);

const LS_KEY_PREFIX = 'crm-companies-columns:';

export function loadColumnIds(workspaceId: string | null | undefined): ColumnId[] {
  if (!workspaceId || typeof window === 'undefined') return DEFAULT_COLUMN_IDS;
  try {
    const raw = window.localStorage.getItem(`${LS_KEY_PREFIX}${workspaceId}`);
    if (!raw) return DEFAULT_COLUMN_IDS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_COLUMN_IDS;
    const valid = parsed.filter((id): id is ColumnId => typeof id === 'string' && id in COLUMN_BY_ID);
    if (valid.length === 0) return DEFAULT_COLUMN_IDS;
    return valid;
  } catch {
    return DEFAULT_COLUMN_IDS;
  }
}

export function saveColumnIds(workspaceId: string | null | undefined, ids: ColumnId[]): void {
  if (!workspaceId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${LS_KEY_PREFIX}${workspaceId}`, JSON.stringify(ids));
  } catch {
    // Quota / privacy mode — silently ignore.
  }
}
