import type { Tables } from '@/lib/database.types';

export type Contact = Tables<'contacts'> & {
  company_name?: string | null;
  company_lifecycle_stage?: string | null;
  company_customer_status?: string | null;
  company_wl_workshop_id?: string | null;
};

export type ColumnId =
  | 'name'
  | 'email'
  | 'phone'
  | 'title'
  | 'company'
  | 'country'
  | 'lead_status'
  | 'status'
  | 'email_status'
  | 'source'
  | 'lifecycle'
  | 'customer_status'
  | 'has_account'
  | 'tags'
  | 'last_emailed_at'
  | 'created_at'
  | 'updated_at';

export type ColumnDef = {
  id: ColumnId;
  label: string;
  /** Default-visible columns ship as the initial layout for new users. */
  default: boolean;
  /** Sortable columns are wired to the SortableTh in the table. */
  sortable: boolean;
};

export const COLUMNS: ColumnDef[] = [
  { id: 'name',              label: 'Name',           default: true,  sortable: true  },
  { id: 'email',             label: 'Email',          default: true,  sortable: true  },
  { id: 'phone',             label: 'Phone',          default: true,  sortable: true  },
  { id: 'title',             label: 'Title',          default: false, sortable: false },
  { id: 'company',           label: 'Company',        default: true,  sortable: true  },
  { id: 'country',           label: 'Country',        default: true,  sortable: true  },
  { id: 'lead_status',       label: 'Lead status',    default: true,  sortable: true  },
  { id: 'status',            label: 'Contact status', default: false, sortable: false },
  { id: 'email_status',      label: 'Email status',   default: false, sortable: false },
  { id: 'source',            label: 'Source',         default: false, sortable: false },
  { id: 'lifecycle',         label: 'Lifecycle',      default: false, sortable: false },
  { id: 'customer_status',   label: 'Customer status',default: false, sortable: false },
  { id: 'has_account',       label: 'App user',       default: false, sortable: false },
  { id: 'tags',              label: 'Tags',           default: false, sortable: false },
  { id: 'last_emailed_at',   label: 'Last emailed',   default: false, sortable: false },
  { id: 'created_at',        label: 'Created',        default: true,  sortable: true  },
  { id: 'updated_at',        label: 'Updated',        default: false, sortable: false },
];

export const COLUMN_BY_ID: Record<ColumnId, ColumnDef> =
  Object.fromEntries(COLUMNS.map((c) => [c.id, c])) as Record<ColumnId, ColumnDef>;

export const DEFAULT_COLUMN_IDS: ColumnId[] = COLUMNS.filter((c) => c.default).map((c) => c.id);

const LS_KEY_PREFIX = 'crm-contacts-columns:';

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
